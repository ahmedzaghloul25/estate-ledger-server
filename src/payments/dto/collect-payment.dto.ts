import { IsOptional, IsDateString } from 'class-validator';

export class CollectPaymentDto {
  @IsOptional()
  @IsDateString()
  paidDate?: string;
}
