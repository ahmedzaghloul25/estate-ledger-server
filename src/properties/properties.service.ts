import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Property, PropertyDocument, PropertyStatus } from './schemas/property.schema';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';

@Injectable()
export class PropertiesService {
  constructor(
    @InjectModel(Property.name, 'primary') private primaryModel: Model<PropertyDocument>,
    @InjectModel(Property.name, 'backup') private backupModel: Model<PropertyDocument>,
  ) {}

  private async dualWrite<T>(
    primaryOp: () => Promise<T>,
    backupOp: () => Promise<unknown>,
  ): Promise<T> {
    const [primaryResult, backupResult] = await Promise.allSettled([primaryOp(), backupOp()]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] properties write failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
    return primaryResult.value;
  }

  async findAll(): Promise<PropertyDocument[]> {
    return this.primaryModel.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<PropertyDocument> {
    const property = await this.primaryModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
    if (!property) throw new NotFoundException('Property not found');
    return property;
  }

  async create(dto: CreatePropertyDto): Promise<PropertyDocument> {
    const propertyId = new Types.ObjectId();
    return this.dualWrite(
      () => new this.primaryModel({ _id: propertyId, ...dto }).save(),
      () => new this.backupModel({ _id: propertyId, ...dto }).save(),
    );
  }

  async update(id: string, dto: UpdatePropertyDto): Promise<PropertyDocument> {
    return this.dualWrite(
      async () => {
        const p = await this.primaryModel.findOneAndUpdate(
          { _id: id, isDeleted: { $ne: true } },
          dto,
          { new: true },
        ).exec();
        if (!p) throw new NotFoundException('Property not found');
        return p;
      },
      () => this.backupModel.findByIdAndUpdate(id, dto).exec(),
    );
  }

  async remove(id: string): Promise<void> {
    const property = await this.primaryModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
    if (!property) throw new NotFoundException('Property not found');
    if (property.status === PropertyStatus.RENTED || property.status === PropertyStatus.OVERDUE) {
      throw new BadRequestException('Cannot delete a property with an active contract');
    }
    await this.dualWrite(
      () => this.primaryModel.findByIdAndUpdate(id, { isDeleted: true }).exec(),
      () => this.backupModel.findByIdAndUpdate(id, { isDeleted: true }).exec(),
    );
  }

  async updateStatus(id: string, status: PropertyStatus): Promise<void> {
    await this.dualWrite(
      () => this.primaryModel.findByIdAndUpdate(id, { status }).exec(),
      () => this.backupModel.findByIdAndUpdate(id, { status }).exec(),
    );
  }
}
