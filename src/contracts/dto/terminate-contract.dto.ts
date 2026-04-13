import { IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class TerminateContractDto {
  @IsOptional()
  @IsDateString()
  @Type(() => String)
  terminationDate?: string;
}
