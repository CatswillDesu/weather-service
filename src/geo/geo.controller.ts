import {
  Controller,
  Get,
  HttpStatus,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GeoService } from './geo.service';
import { LocationQueryDto } from './dto/request/search-location.dto';
import { GeoSearchResponseDto } from './dto/response/geo-search-response.dto';
import { ApplicationResponseDto } from '../common/dto/application-response.dto';

@ApiTags('geo')
@Controller({
  path: 'geo',
  version: '1.0',
})
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search for locations by name' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of matching locations with coordinates.',
    type: ApplicationResponseDto,
  })
  @UsePipes(new ValidationPipe({ transform: true }))
  async searchLocation(
    @Query() query: LocationQueryDto,
  ): Promise<ApplicationResponseDto<GeoSearchResponseDto[]>> {
    const results = await this.geoService.search(query.name, query.limit);
    
    return {
      data: results,
      metadata: {
        limit: query.limit,
        count: results.length,
      },
    };
  }
}
