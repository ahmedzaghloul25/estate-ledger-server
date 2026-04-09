import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TenantDocument = Tenant & Document;

@Schema({ timestamps: true })
export class Tenant {
  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ trim: true })
  phone: string;

  @Prop({ required: true, trim: true })
  identificationId: string;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);
TenantSchema.index({ identificationId: 1 }, { unique: true });
TenantSchema.index({ isDeleted: 1 });
