import { IsOptional, IsNumber, IsDateString, Min } from 'class-validator';

export class UpdateContractDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  rent?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
