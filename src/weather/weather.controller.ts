import {
  Controller,
  Get,
  HttpStatus,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApplicationResponseDto } from '../common/dto/application-response.dto';
import { ForecastEntryDto } from './dto/response/forecast.dto';
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
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Daily weather forecast.',
    type: ApplicationResponseDto,
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  async getWeather(
    @Query() query: CoordinatesQueryDto,
  ): Promise<ApplicationResponseDto<ForecastEntryDto[]>> {
    return this.weatherService.getWeather(query.lat, query.lon);
  }
}
