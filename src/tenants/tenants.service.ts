import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from './schemas/tenant.schema';
import { Contract, ContractDocument } from '../contracts/schemas/contract.schema';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  constructor(
    @InjectModel(Tenant.name, 'primary') private primaryModel: Model<TenantDocument>,
    @InjectModel(Tenant.name, 'backup') private backupModel: Model<TenantDocument>,
    @InjectModel(Contract.name, 'primary') private contractModel: Model<ContractDocument>,
  ) {}

  private async dualWrite<T>(
    primaryOp: () => Promise<T>,
    backupOp: () => Promise<unknown>,
  ): Promise<T> {
    const [primaryResult, backupResult] = await Promise.allSettled([primaryOp(), backupOp()]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] tenants write failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
    return primaryResult.value;
  }

  async findAll(): Promise<TenantDocument[]> {
    return this.primaryModel.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).exec();
  }

  async findById(id: string): Promise<TenantDocument> {
    const tenant = await this.primaryModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto): Promise<TenantDocument> {
    const tenantId = new Types.ObjectId();
    return this.dualWrite(
      () => new this.primaryModel({ _id: tenantId, ...dto }).save(),
      () => new this.backupModel({ _id: tenantId, ...dto }).save(),
    );
  }

  async update(id: string, dto: UpdateTenantDto): Promise<TenantDocument> {
    return this.dualWrite(
      async () => {
        const t = await this.primaryModel.findOneAndUpdate(
          { _id: id, isDeleted: { $ne: true } },
          dto,
          { new: true },
        ).exec();
        if (!t) throw new NotFoundException('Tenant not found');
        return t;
      },
      () => this.backupModel.findByIdAndUpdate(id, dto).exec(),
    );
  }

  async remove(id: string): Promise<void> {
    const tenant = await this.primaryModel.findOne({ _id: id, isDeleted: { $ne: true } }).exec();
    if (!tenant) throw new NotFoundException('Tenant not found');

    const activeContract = await this.contractModel.findOne({
      tenantId: new Types.ObjectId(id),
      isEarlyTerminated: { $ne: true },
      endDate: { $gt: new Date() },
    }).exec();
    if (activeContract) {
      throw new BadRequestException('Cannot delete a tenant with an active contract');
    }

    await this.dualWrite(
      () => this.primaryModel.findByIdAndUpdate(id, { isDeleted: true }).exec(),
      () => this.backupModel.findByIdAndUpdate(id, { isDeleted: true }).exec(),
    );
  }
}
