import { Expose, Type } from 'class-transformer';

export class YrDetailsDto {
  @Expose()
  air_temperature: number;
}

export class YrInstantDto {
  @Expose()
  @Type(() => YrDetailsDto)
  details: YrDetailsDto;
}

export class YrDataDto {
  @Expose()
  @Type(() => YrInstantDto)
  instant: YrInstantDto;
}

export class YrTimeSeriesDto {
  @Expose()
  time: string;

  @Expose()
  @Type(() => YrDataDto)
  data: YrDataDto;
}

export class YrPropertiesDto {
  @Expose()
  @Type(() => YrTimeSeriesDto)
  timeseries: YrTimeSeriesDto[];
}

export class YrResponseDto {
  @Expose()
  @Type(() => YrPropertiesDto)
  properties: YrPropertiesDto;
}
