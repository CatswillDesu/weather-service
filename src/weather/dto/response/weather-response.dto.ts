import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class WeatherResponseMetadataDto {
  @ApiProperty({ example: 10, description: 'Number of forecast days returned' })
  @Expose()
  forecastDays: number;

  @ApiProperty({ example: 'Europe/Belgrade (+01:00)', description: 'Timezone of the location' })
  @Expose()
  timezone: string;
}
