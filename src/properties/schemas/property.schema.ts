import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PropertyDocument = Property & Document;

export enum PropertyStatus {
  RENTED = 'rented',
  AVAILABLE = 'available',
  OVERDUE = 'overdue',
}

@Schema({ timestamps: true })
export class Property {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true })
  address: string;

  @Prop({ type: Number })
  area: number;

  @Prop({ type: String, enum: PropertyStatus, default: PropertyStatus.AVAILABLE })
  status: PropertyStatus;

  @Prop({ type: Boolean, default: false })
  isDeleted: boolean;
}

export const PropertySchema = SchemaFactory.createForClass(Property);
PropertySchema.index({ status: 1 });
PropertySchema.index({ isDeleted: 1 });
