import {
  Controller,
  Get,
  HttpStatus,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { ApplicationResponseDto } from '../common/dto/application-response.dto';
import { ForecastEntryDto } from './dto/response/forecast.dto';
import { WeatherResponseMetadataDto } from './dto/response/weather-response.dto';
import { WeatherService } from './weather.service';
import { CoordinatesQueryDto } from './dto/request/search-weather.dto';

@ApiTags('weather')
@Controller({
  path: 'weather',
  version: '1.0',
})
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  @Get()
  @ApiOperation({ summary: 'Get weather forecast by coordinates' })
  @ApiExtraModels(
    ApplicationResponseDto,
    ForecastEntryDto,
    WeatherResponseMetadataDto,
  )
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Daily weather forecast.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ApplicationResponseDto) },
        {
          properties: {
            data: {
              type: 'array',
              items: { $ref: getSchemaPath(ForecastEntryDto) },
            },
            metadata: {
              $ref: getSchemaPath(WeatherResponseMetadataDto),
            },
          },
        },
      ],
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid coordinates provided',
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Internal server error or external API failure',
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  async getWeather(
    @Query() query: CoordinatesQueryDto,
  ): Promise<ApplicationResponseDto<ForecastEntryDto[]>> {
    return this.weatherService.getWeather(query.lat, query.lon);
  }
}
