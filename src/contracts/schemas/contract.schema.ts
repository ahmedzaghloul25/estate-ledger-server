import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ContractDocument = Contract & Document;

export enum PaymentInterval {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  SEMI_ANNUALLY = 'Semi-Annually',
  ANNUALLY = 'Annually',
}

export enum ContractStatus {
  ACTIVE = 'active',
  EXPIRING = 'expiring',
  EXPIRED = 'expired',
  TERMINATED = 'terminated',
}

@Schema({ timestamps: true })
export class Contract {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Property', required: true })
  propertyId: Types.ObjectId;

  @Prop({ required: true })
  rent: number;

  @Prop({ type: String, enum: PaymentInterval, required: true })
  paymentInterval: PaymentInterval;

  @Prop({ default: 0 })
  securityDeposit: number;

  @Prop({ default: 0 })
  annualIncrease: number;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ type: String, enum: ContractStatus, default: ContractStatus.ACTIVE })
  status: ContractStatus;

  @Prop({ default: false })
  isEarlyTerminated: boolean;

  @Prop({ type: Boolean, default: false })
  isExpired: boolean;
}

export const ContractSchema = SchemaFactory.createForClass(Contract);
ContractSchema.index({ tenantId: 1 });
ContractSchema.index({ propertyId: 1 });
ContractSchema.index({ status: 1 });
ContractSchema.index({ endDate: 1 });
ContractSchema.index({ isExpired: 1 });
