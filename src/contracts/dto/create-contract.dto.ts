import {
  IsString, IsNotEmpty, IsNumber, IsDateString, IsEnum, IsOptional, Min,
} from 'class-validator';
import { PaymentInterval } from '../schemas/contract.schema';

export class CreateContractDto {
  @IsString()
  @IsNotEmpty()
  tenantId: string;

  @IsString()
  @IsNotEmpty()
  propertyId: string;

  @IsNumber()
  @Min(0)
  rent: number;

  @IsEnum(PaymentInterval)
  paymentInterval: PaymentInterval;

  @IsOptional()
  @IsNumber()
  @Min(0)
  securityDeposit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  annualIncrease?: number;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
