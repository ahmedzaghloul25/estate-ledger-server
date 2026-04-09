import { IsOptional, IsDateString } from 'class-validator';

export class TerminateContractDto {
  @IsOptional()
  @IsDateString()
  terminationDate?: string;
}
