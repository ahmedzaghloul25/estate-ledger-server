import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
  @Prop({type: Types.ObjectId})
  _id: Types.ObjectId
  
  @Prop({ type: Types.ObjectId, ref: 'Contract', required: true })
  contractId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Property', required: true })
  propertyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true })
  month: Date;

  @Prop({ required: true })
  amount: number;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({ type: Date, default: null })
  paidDate: Date | null;

  @Prop({ type: Boolean, default: false })
  isVoided: boolean;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ contractId: 1 });
PaymentSchema.index({ dueDate: 1 });
PaymentSchema.index({ propertyId: 1, month: 1 });
PaymentSchema.index({ tenantId: 1, dueDate: 1 });
