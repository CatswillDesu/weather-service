import { ApiProperty } from '@nestjs/swagger';
import { Expose, Transform } from 'class-transformer';

export class GeoSearchResponseDto {
  @ApiProperty({ example: 'Belgrade, Central Serbia, Serbia' })
  @Expose({ name: 'display_name' })
  locationName: string;

  @ApiProperty({ example: 44.8178 })
  @Expose()
  @Transform(({ value }) => parseFloat(Number(value).toFixed(4)))
  lat: number;

  @ApiProperty({ example: 20.4568 })
  @Expose()
  @Transform(({ value }) => parseFloat(Number(value).toFixed(4)))
  lon: number;
}
