import { IsOptional, IsNumber, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateContractDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  rent?: number;

  @IsOptional()
  @IsDateString()
  @Type(() => String)
  startDate?: string;

  @IsOptional()
  @IsDateString()
  @Type(() => String)
  endDate?: string;
}
