import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  Contract, ContractDocument, ContractStatus,
} from './schemas/contract.schema';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { TerminateContractDto } from './dto/terminate-contract.dto';
import { PaymentsService } from '../payments/payments.service';
import { PropertiesService } from '../properties/properties.service';
import { PropertyStatus } from '../properties/schemas/property.schema';

@Injectable()
export class ContractsService {
  private readonly logger = new Logger(ContractsService.name);

  constructor(
    @InjectModel(Contract.name, 'primary') private primaryModel: Model<ContractDocument>,
    @InjectModel(Contract.name, 'backup') private backupModel: Model<ContractDocument>,
    private paymentsService: PaymentsService,
    private propertiesService: PropertiesService,
  ) {}

  computeContractStatus(contract: { endDate: Date; isEarlyTerminated: boolean; status: ContractStatus }): ContractStatus {
    if (contract.status === ContractStatus.TERMINATED) return ContractStatus.TERMINATED;
    const now = new Date();
    const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    if (contract.endDate < now) return ContractStatus.EXPIRED;
    if (contract.endDate <= sixtyDaysFromNow) return ContractStatus.EXPIRING;
    return ContractStatus.ACTIVE;
  }

  /**
   * Normalize a date to midnight UTC matching the intended local date.
   * Handles both string and Date inputs (ValidationPipe transform may convert).
   *
   * The client sends dates from a calendar picker as midnight local time, which
   * arrives as either an offset string ("2024-01-01T00:00:00+03:00") or a
   * UTC-converted string ("2023-12-31T21:00:00.000Z"). In both cases, JS parses
   * to the same UTC instant. If UTC hours >= 12, the intended local date is the
   * next UTC day — round up to recover it.
   */
  private normalizeDateToUTC(dateInput: string | Date): Date {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    let year = d.getUTCFullYear();
    let month = d.getUTCMonth();
    let day = d.getUTCDate();

    if (d.getUTCHours() >= 12) {
      const next = new Date(Date.UTC(year, month, day + 1));
      year = next.getUTCFullYear();
      month = next.getUTCMonth();
      day = next.getUTCDate();
    }

    return new Date(Date.UTC(year, month, day));
  }

  private applyComputedStatus(contract: ContractDocument): ContractDocument {
    contract.status = this.computeContractStatus(contract);
    return contract;
  }

  async findAll(status?: string): Promise<ContractDocument[]> {
    const contracts = await this.primaryModel.find({ isExpired: { $ne: true } }).sort({ createdAt: -1 }).populate(['tenantId', 'propertyId']).exec();
    const computed = contracts.map((c) => this.applyComputedStatus(c));
    if (status) return computed.filter((c) => c.status === status);
    return computed;
  }

  async findById(id: string): Promise<ContractDocument> {
    const contract = await this.primaryModel.findById(id).populate(['tenantId', 'propertyId']).exec();
    if (!contract) throw new NotFoundException('Contract not found');
    return this.applyComputedStatus(contract);
  }

  async create(dto: CreateContractDto): Promise<ContractDocument> {
    const existingContract = await this.primaryModel.findOne({
      propertyId: new Types.ObjectId(dto.propertyId),
      status: { $ne: ContractStatus.TERMINATED },
      isExpired: { $ne: true },
      endDate: { $gte: new Date() },
    }).exec();

    if (existingContract) {
      throw new BadRequestException('This property already has an active contract');
    }

    // Pre-generate _id so both DBs store the same ObjectId — payments reference it
    const contractId = new Types.ObjectId();
    const contractData = {
      _id: contractId,
      tenantId: new Types.ObjectId(dto.tenantId),
      propertyId: new Types.ObjectId(dto.propertyId),
      rent: dto.rent,
      paymentInterval: dto.paymentInterval,
      securityDeposit: dto.securityDeposit ?? 0,
      annualIncrease: dto.annualIncrease ?? 0,
      startDate: this.normalizeDateToUTC(dto.startDate),
      endDate: this.normalizeDateToUTC(dto.endDate),
    };

    const [primaryResult, backupResult] = await Promise.allSettled([
      new this.primaryModel(contractData).save(),
      new this.backupModel(contractData).save(),
    ]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] contract create failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;

    const contract = primaryResult.value;
    await contract.populate(['tenantId', 'propertyId']);

    // These services manage their own dual-writes internally
    await this.paymentsService.generateSchedule({
      _id: contract._id as Types.ObjectId,
      propertyId: contract.propertyId as Types.ObjectId,
      tenantId: contract.tenantId as Types.ObjectId,
      rent: contract.rent,
      paymentInterval: contract.paymentInterval,
      annualIncrease: contract.annualIncrease,
      startDate: contract.startDate,
      endDate: contract.endDate,
    });
    await this.propertiesService.updateStatus(dto.propertyId, PropertyStatus.RENTED);

    return this.applyComputedStatus(contract);
  }

  async update(id: string, dto: UpdateContractDto): Promise<ContractDocument> {
    const updateData: any = { ...dto };
    if (dto.startDate) updateData.startDate = this.normalizeDateToUTC(dto.startDate);
    if (dto.endDate) updateData.endDate = this.normalizeDateToUTC(dto.endDate);

    const [primaryResult, backupResult] = await Promise.allSettled([
      this.primaryModel.findByIdAndUpdate(id, updateData, { new: true }).populate(['tenantId', 'propertyId']).exec(),
      this.backupModel.findByIdAndUpdate(id, updateData).exec(),
    ]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] contract update failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
    const contract = primaryResult.value;
    if (!contract) throw new NotFoundException('Contract not found');
    return this.applyComputedStatus(contract);
  }

  async terminate(id: string, dto: TerminateContractDto): Promise<ContractDocument> {
    const contract = await this.primaryModel.findById(id).exec();
    if (!contract) throw new NotFoundException('Contract not found');
    if (
      contract.status === ContractStatus.TERMINATED ||
      this.computeContractStatus(contract) === ContractStatus.EXPIRED
    ) {
      throw new BadRequestException('Contract is already terminated or expired');
    }

    const terminationDate = dto.terminationDate ? this.normalizeDateToUTC(dto.terminationDate) : new Date();
    contract.isEarlyTerminated = true;
    contract.status = ContractStatus.TERMINATED;
    contract.endDate = terminationDate;

    const [primaryResult, backupResult] = await Promise.allSettled([
      contract.save(),
      this.backupModel.findByIdAndUpdate(id, {
        isEarlyTerminated: true,
        status: ContractStatus.TERMINATED,
        endDate: terminationDate,
      }).exec(),
    ]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] contract terminate failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;

    // These services manage their own dual-writes internally
    await this.paymentsService.voidFuturePayments(id, terminationDate);
    await this.propertiesService.updateStatus(contract.propertyId.toString(), PropertyStatus.AVAILABLE);

    await contract.populate(['tenantId', 'propertyId']);
    return contract;
  }

  @Cron('0 0 1 * *')
  async softDeleteExpiredContracts(): Promise<void> {
    const now = new Date();
    const filter = {
      endDate: { $lt: now },
      status: { $ne: ContractStatus.TERMINATED },
      isExpired: { $ne: true },
    };

    const expiredContracts = await this.primaryModel.find(filter).exec();
    if (expiredContracts.length === 0) return;

    const ids = expiredContracts.map((c) => c._id);
    const update = { isExpired: true, status: ContractStatus.EXPIRED };

    const [primaryResult, backupResult] = await Promise.allSettled([
      this.primaryModel.updateMany({ _id: { $in: ids } }, update).exec(),
      this.backupModel.updateMany({ _id: { $in: ids } }, update).exec(),
    ]);
    if (backupResult.status === 'rejected') {
      this.logger.error('[Backup DB] softDeleteExpiredContracts failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;

    const propertyIds = [...new Set(expiredContracts.map((c) => c.propertyId.toString()))];
    for (const propertyId of propertyIds) {
      await this.propertiesService.updateStatus(propertyId, PropertyStatus.AVAILABLE);
    }

    this.logger.log(`Soft-deleted ${expiredContracts.length} expired contracts`);
  }
}
