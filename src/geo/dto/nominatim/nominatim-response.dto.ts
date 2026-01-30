import { Expose } from 'class-transformer';

export class NominatimResponseDto {
  @Expose()
  place_id: number;

  @Expose()
  licence: string;

  @Expose()
  osm_type: string;

  @Expose()
  osm_id: number;

  @Expose()
  boundingbox: string[];

  @Expose()
  lat: string;

  @Expose()
  lon: string;

  @Expose()
  display_name: string;

  @Expose()
  class: string;

  @Expose()
  type: string;

  @Expose()
  importance: number;

  @Expose()
  icon?: string;
}
