import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class ApplicationResponseDto<T> {
  @Expose()
  data: T;

  @ApiProperty({ required: false })
  @Expose()
  metadata?: Record<string, unknown>;
}
