import {
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
import { GeoSearchResponseDto } from './dto/response/geo-search-response.dto';
import { NominatimResponseDto } from './dto/nominatim/nominatim-response.dto';

@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  constructor(
    private configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  private get nominatimApiUrl(): string {
    return this.configService.get<string>(
      'NOMINATIM_API_URL',
      'https://nominatim.openstreetmap.org',
    );
  }

  private get userAgent(): string {
    return this.configService.get<string>(
      'USER_AGENT',
      'WeatherService/1.0',
    );
  }

  async search(name: string, limit = 10): Promise<GeoSearchResponseDto[]> {
    const cacheKey = `geo:search:${name.toLowerCase().trim()}:${limit}:v4`;
    const cached = await this.cacheManager.get<GeoSearchResponseDto[]>(cacheKey);

    if (cached) {
      this.logger.debug(`Geocoding cache HIT for "${name}" with limit ${limit}`);
      return cached;
    }

    this.logger.debug(
      `Geocoding cache MISS for "${name}". Requesting Nominatim with limit ${limit}.`,
    );

    try {
      const response = await axios.get<NominatimResponseDto[]>(
        `${this.nominatimApiUrl}/search`,
        {
          params: {
            q: name,
            format: 'json',
            limit,
          },
          headers: {
            'User-Agent': this.userAgent,
          },
        },
      );

      if (!response.data) {
        return [];
      }

      const results = plainToInstance(
        GeoSearchResponseDto,
        response.data,
        {
          excludeExtraneousValues: true,
        },
      );

      await this.cacheManager.set(cacheKey, results, 0);

      return results;
    } catch (error) {
      this.logger.error(error, `Failed to search location: "${name}"`);
      throw new InternalServerErrorException('Geocoding service unavailable');
    }
  }
}
