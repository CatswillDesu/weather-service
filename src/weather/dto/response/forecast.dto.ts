import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ForecastEntryDto {
  @ApiProperty({ example: '2026-01-29T13:00:00Z' })
  @Expose()
  date: string;

  @ApiProperty({ example: 13.6 })
  @Expose()
  temperature: number;
}
