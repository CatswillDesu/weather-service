import { Test, TestingModule } from '@nestjs/testing';
import { WeatherService } from './weather.service';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import axios from 'axios';
import { YrResponseDto } from './dto/yr/yr-response.dto';
import { HttpStatus } from '@nestjs/common';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WeatherService', () => {
  let service: WeatherService;
  let memoryCache: Map<string, any>;

  beforeEach(async () => {
    memoryCache = new Map();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn((key) => memoryCache.get(key)),
            set: jest.fn((key, value, ttl) =>
              memoryCache.set(key, { ...value, ttl_mock: ttl }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get<WeatherService>(WeatherService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Helper to create the nested Yr.no response structure
   */
  function createMockResponse(
    times: string[],
    baseDate = '2026-01-30',
  ): YrResponseDto {
    return {
      properties: {
        timeseries: times.map((timeStr) => ({
          time: `${baseDate}T${timeStr}`,
          data: {
            instant: {
              details: { air_temperature: 20.5 },
            },
          } as any, // casting to avoid full object mock
        })),
      },
    };
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Business Logic: Forecast Selection (14:00 Local Target)', () => {
    it('should select ~13:00 UTC for Belgrade (UTC+1) to match 14:00 Local', async () => {
      // Belgrade is UTC+1 (Winter). Target 14:00 Local = 13:00 UTC.
      const mockData = createMockResponse([
        '10:00:00Z',
        '13:00:00Z',
        '16:00:00Z',
      ]);

      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.OK,
        data: mockData,
        headers: {},
      });

      const lat = 44.8178;
      const lon = 20.4568;

      const result = await service.getWeather(lat, lon);

      expect(result.metadata.timezone).toContain('Europe/Belgrade');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].date).toContain('13:00:00Z');
    });

    it('should select ~19:00 UTC for New York (UTC-5) to match 14:00 Local', async () => {
      // New York is UTC-5 (Winter). Target 14:00 Local = 19:00 UTC.
      const mockData = createMockResponse([
        '12:00:00Z',
        '19:00:00Z',
        '22:00:00Z',
      ]);

      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.OK,
        data: mockData,
        headers: {},
      });

      const lat = 40.7128;
      const lon = -74.0060;

      const result = await service.getWeather(lat, lon);

      expect(result.metadata.timezone).toContain('America/New_York');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].date).toContain('19:00:00Z');
    });

    it('should exclude days where the best available forecast is > 3 hours from target', async () => {
      // Scenario: API returns only night time data (e.g. 02:00 Local).
      // Target 14:00. Diff 12h. Skip.
      const mockData = createMockResponse(['01:00:00Z']); // 02:00 Local in Belgrade

      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.OK,
        data: mockData,
        headers: {},
      });

      const result = await service.getWeather(44.8178, 20.4568);

      expect(result.data).toHaveLength(0);
    });

    it('should include days where diff is exactly 3 hours (boundary check)', async () => {
      // Target 14:00. Available 17:00 Local. Diff = 3. Keep.
      const mockData = createMockResponse(['16:00:00Z']); // 17:00 Local in Belgrade

      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.OK,
        data: mockData,
        headers: {},
      });

      const result = await service.getWeather(44.8178, 20.4568);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].date).toContain('16:00:00Z');
    });
  });

  describe('Integration Logic: Caching Strategy', () => {
    const lat = 50.0;
    const lon = 10.0;
    const mockData = createMockResponse(['12:00:00Z']);

    it('should fetch from API on cache MISS and populate cache', async () => {
      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.OK,
        data: mockData,
        headers: {
          'last-modified': 'Tue, 15 Nov 1994 12:45:26 GMT',
          expires: 'Tue, 15 Nov 1994 13:45:26 GMT',
        },
      });

      await service.getWeather(lat, lon);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(memoryCache.size).toBeGreaterThan(0);
    });

    it('should return from cache on HIT (before expiry)', async () => {
      const cacheKey = `weather:${lat.toFixed(4)}:${lon.toFixed(4)}`;
      memoryCache.set(cacheKey, {
        data: mockData,
        expires: Date.now() + 10000, // Valid
        lastModified: 'Old-Date',
      });

      const result = await service.getWeather(lat, lon);

      expect(mockedAxios.get).not.toHaveBeenCalled(); // Should NOT call API
      expect(result.data).toBeDefined();
    });

    it('should use If-Modified-Since header when cache exists but is expired', async () => {
      const cacheKey = `weather:${lat.toFixed(4)}:${lon.toFixed(4)}`;
      memoryCache.set(cacheKey, {
        data: mockData,
        expires: Date.now() - 1000, // Expired
        lastModified: 'Old-Date',
      });

      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.OK,
        data: mockData,
        headers: {},
      });

      await service.getWeather(lat, lon);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      const headers = mockedAxios.get.mock.calls[0][1].headers;
      expect(headers['If-Modified-Since']).toBe('Old-Date');
    });

    it('should handle 304 Not Modified and update cache expiry without payload', async () => {
      const cacheKey = `weather:${lat.toFixed(4)}:${lon.toFixed(4)}`;
      // Add a marker to ensure we got the old data back
      (mockData.properties as any).testMarker = 'original-data';

      memoryCache.set(cacheKey, {
        data: mockData,
        expires: Date.now() - 1000,
        lastModified: 'Old-Date',
      });

      // Mock 304 response (empty body)
      mockedAxios.get.mockResolvedValue({
        status: HttpStatus.NOT_MODIFIED,
        data: '',
        headers: { expires: new Date(Date.now() + 3600000).toUTCString() },
      });

      await service.getWeather(lat, lon);

      // Verify we returned the cached object (via processTimeSeries)
      // Since processTimeSeries extracts data, we can't check the marker on the result directly easily without casting
      // But we can check if memoryCache was updated with new expiry
      const cachedItem = memoryCache.get(cacheKey);
      expect(cachedItem.expires).toBeGreaterThan(Date.now());
      // Data should remain untouched
      expect((cachedItem.data.properties as any).testMarker).toBe(
        'original-data',
      );
    });
  });
});
