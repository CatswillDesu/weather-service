import {
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import axios from 'axios';
import { plainToInstance } from 'class-transformer';
import { ApplicationResponseDto } from '../common/dto/application-response.dto';
import { ForecastEntryDto } from './dto/response/forecast.dto';
import { YrResponseDto, YrTimeSeriesDto } from './dto/yr/yr-response.dto';
import Bottleneck from 'bottleneck';
import { find } from 'geo-tz';
import { DateTime } from 'luxon';

interface CachedWeatherState {
  data: YrResponseDto;
  expires: number;
  lastModified: string;
}

const FORECAST_TARGET_HOUR = 14;
const WEATHER_CACHE_TTL = 48 * 60 * 60 * 1000; 

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly limiter: Bottleneck;

  constructor(
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    // Configure rate limiter for Yr.no API
    // Limit to ~15 requests per second to be safe (official limit is ~20 req/sec)
    this.limiter = new Bottleneck({
      minTime: 66, // Minimum 66ms between requests (~15 req/sec)
      maxConcurrent: 5, // Optional: limit concurrent requests
    });

    this.limiter.on('error', (error) => {
      this.logger.error(error, 'Rate limiter error');
    });
  }

  private get yrApiUrl(): string {
    return this.configService.get<string>(
      'YR_API_URL',
      'https://api.met.no/weatherapi/locationforecast/2.0/compact',
    );
  }

  private get userAgent(): string {
    return this.configService.get<string>(
      'USER_AGENT',
      'BelgradeWeatherService/1.0 (test@example.com)',
    );
  }

  async getWeather(
    lat: number,
    lon: number,
  ): Promise<ApplicationResponseDto<ForecastEntryDto[]>> {
    try {
      const response = await this.fetchForecastData(lat, lon);
      
      // 1. Determine the accurate Timezone ID from coordinates
      // geo-tz works offline and handles political boundaries correctly
      const [timeZoneId] = find(lat, lon);
      
      const timeseries = response.properties.timeseries;
      const forecasts = this.processTimeSeries(timeseries, timeZoneId);

      const forecastDays = forecasts.length;
      
      // Calculate current offset for metadata using Luxon
      const now = DateTime.now().setZone(timeZoneId);
      const offsetName = now.toFormat('ZZ'); // e.g. +01:00
      const timezone = `${timeZoneId} (${offsetName})`;

      return {
        data: forecasts,
        metadata: {
          forecastDays,
          timezone,
        },
      };
    } catch (error) {
      this.logger.error(error, `Failed to fetch weather for ${lat}, ${lon}`);
      throw new InternalServerErrorException('Failed to fetch weather data');
    }
  }

  private async fetchForecastData(
    lat: number,
    lon: number,
  ): Promise<YrResponseDto> {
    const latKey = lat.toFixed(4);
    const lonKey = lon.toFixed(4);
    const cacheKey = `weather:${latKey}:${lonKey}`;

    const now = Date.now();
    const cachedState = await this.cacheManager.get<CachedWeatherState>(cacheKey);

    if (cachedState && now < cachedState.expires) {
      this.logger.debug(`Weather cache HIT for ${lat}, ${lon}`);
      return cachedState.data;
    }

    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
    };

    if (cachedState?.lastModified) {
      this.logger.debug(
        `Cache stale for ${lat}, ${lon}. Validating with If-Modified-Since`,
      );
      headers['If-Modified-Since'] = cachedState.lastModified;
    } else {
      this.logger.debug(`Weather cache MISS for ${lat}, ${lon}`);
    }

    try {
      const response = await this.limiter.schedule(() =>
        axios.get(this.yrApiUrl, {
          params: { lat, lon },
          headers,
          validateStatus: (status) =>
            status >= HttpStatus.OK && status < HttpStatus.BAD_REQUEST,
        }),
      );

      if (response.status === HttpStatus.NOT_MODIFIED) {
        if (!cachedState) {
          throw new InternalServerErrorException(
            'Received 304 but no cache available',
          );
        }
        if (response.headers['expires']) {
          cachedState.expires = new Date(response.headers['expires']).getTime();
          await this.cacheManager.set(cacheKey, cachedState, WEATHER_CACHE_TTL);
        }
        return cachedState.data;
      }

      if (response.status === HttpStatus.NON_AUTHORITATIVE_INFORMATION) {
        this.logger.warn('Yr.no API returned 203: Product is deprecated.');
      }

      const data = plainToInstance(YrResponseDto, response.data, {
        excludeExtraneousValues: true,
      });

      const expiresHeader = response.headers['expires'];
      const lastModifiedHeader = response.headers['last-modified'];

      let expires = Date.now() + 30 * 60 * 1000;
      if (expiresHeader) {
        expires = new Date(expiresHeader).getTime();
      }

      const newState: CachedWeatherState = {
        data,
        expires,
        lastModified: lastModifiedHeader || new Date().toUTCString(),
      };

      await this.cacheManager.set(cacheKey, newState, WEATHER_CACHE_TTL);

      return data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === HttpStatus.TOO_MANY_REQUESTS) {
          this.logger.warn('Rate limit hit on Yr.no API');
          throw new InternalServerErrorException('Weather API Throttling');
        }
      }
      throw error;
    }
  }

  private processTimeSeries(
    timeseries: YrTimeSeriesDto[],
    timeZoneId: string,
  ): ForecastEntryDto[] {
    const dailyForecasts: Record<string, YrTimeSeriesDto> = {};

    for (const entry of timeseries) {
      const dateKey = this.getDateKey(entry.time);
      const currentBest = dailyForecasts[dateKey];

      if (!currentBest) {
        dailyForecasts[dateKey] = entry;
        continue;
      }

      // Pass timeZoneId to helper to compare local times accurately
      if (this.isCloserToTargetTime(entry.time, currentBest.time, timeZoneId)) {
        dailyForecasts[dateKey] = entry;
      }
    }

    const result: ForecastEntryDto[] = [];
    const sortedKeys = Object.keys(dailyForecasts).sort();

    for (const key of sortedKeys) {
      const entry = dailyForecasts[key];
      
      const diff = this.getLocalHoursDifference(entry.time, timeZoneId);
      if (diff > 3) {
        continue; // Skip this day if we don't have a forecast close to target hour
      }

      const forecastEntry = plainToInstance(
        ForecastEntryDto,
        {
          date: entry.time,
          temperature: entry.data.instant.details.air_temperature,
        },
        { excludeExtraneousValues: true },
      );
      result.push(forecastEntry);
    }
    return result;
  }

  private getDateKey(isoString: string): string {
    return isoString.split('T')[0];
  }

  private isCloserToTargetTime(
    newTime: string,
    currentTime: string,
    timeZoneId: string,
  ): boolean {
    const newDiff = this.getLocalHoursDifference(newTime, timeZoneId);
    const currentDiff = this.getLocalHoursDifference(currentTime, timeZoneId);
    return newDiff < currentDiff;
  }

  /**
   * Calculates difference between the timestamp's LOCAL hour and target (14:00).
   * Handles DST and political timezones automatically via Luxon.
   */
  private getLocalHoursDifference(isoString: string, timeZoneId: string): number {
    const dt = DateTime.fromISO(isoString).setZone(timeZoneId);
    const localHour = dt.hour;
    const targetHour = FORECAST_TARGET_HOUR;

    const diff = Math.abs(localHour - targetHour);
    return Math.min(diff, 24 - diff);
  }
}
