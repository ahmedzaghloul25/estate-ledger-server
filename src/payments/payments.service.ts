import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { CollectPaymentDto } from './dto/collect-payment.dto';
import { PropertiesService } from '../properties/properties.service';
import { PropertyStatus } from '../properties/schemas/property.schema';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name, 'primary') private primaryModel: Model<PaymentDocument>,
    @InjectModel(Payment.name, 'backup') private backupModel: Model<PaymentDocument>,
    private propertiesService: PropertiesService,
  ) {}

  async generateSchedule(contract: {
    _id: Types.ObjectId;
    propertyId: Types.ObjectId;
    tenantId: Types.ObjectId;
    rent: number;
    paymentInterval: string;
    annualIncrease: number;
    startDate: Date;
    endDate: Date;
  }): Promise<void> {
    const intervalMonths: Record<string, number> = {
      Monthly: 1,
      Quarterly: 3,
      'Semi-Annually': 6,
      Annually: 12,
    };
    const step = intervalMonths[contract.paymentInterval] || 1;
    const payments: Partial<Payment>[] = [];
    const start = new Date(contract.startDate);
    const end = new Date(contract.endDate);

    // Recover the intended local date from the UTC-stored timestamp.
    // Clients send dates as local midnight (e.g. 2025-07-01T00:00:00+03:00),
    // which gets stored as 2025-06-30T21:00:00Z. If the UTC hour is >= 12,
    // the local date is one day ahead of the UTC date.
    const normalizedStart = new Date(Date.UTC(
      start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
    ));
    if (start.getUTCHours() >= 12) {
      normalizedStart.setUTCDate(normalizedStart.getUTCDate() + 1);
    }
    const offsetMs = normalizedStart.getTime() - start.getTime();
    const startDay = normalizedStart.getUTCDate();
    const startMonth = normalizedStart.getUTCMonth();
    const startYear = normalizedStart.getUTCFullYear();
    let periodIndex = 0;

    while (true) {
      // Compute the target local year/month from the original start
      const totalMonths = startMonth + periodIndex * step;
      const targetYear = startYear + Math.floor(totalMonths / 12);
      const targetMonth = totalMonths % 12;

      // Clamp day to the last day of the target month (e.g. Jan 31 → Feb 28)
      const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
      const targetDay = Math.min(startDay, lastDay);

      // Convert local midnight back to UTC by subtracting the offset
      const date = new Date(Date.UTC(targetYear, targetMonth, targetDay) - offsetMs);

      if (date >= end) break;

      const yearsPassed = Math.max(0, Math.floor((periodIndex * step) / 12));
      const multiplier = Math.pow(1 + contract.annualIncrease / 100, yearsPassed);
      const amount = Math.round(contract.rent * multiplier * 100) / 100;
      const id = new Types.ObjectId();

      payments.push({
        _id: id,
        contractId: contract._id,
        propertyId: contract.propertyId,
        tenantId: contract.tenantId,
        month: new Date(Date.UTC(targetYear, targetMonth, 1)),
        amount,
        dueDate: new Date(date),
        paidDate: null,
      });

      periodIndex++;
    }

    const [primaryResult, backupResult] = await Promise.allSettled([
      this.primaryModel.insertMany(payments),
      this.backupModel.insertMany(payments),
    ]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] generateSchedule insertMany failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
  }

  async findAll(query: { contractId?: string; status?: string }): Promise<PaymentDocument[]> {
    const filter: any = {};
    if (query.contractId) filter.contractId = new Types.ObjectId(query.contractId);
    if (query.status) {
      const now = new Date();
      switch (query.status) {
        case 'paid':
          filter.paidDate = { $ne: null };
          filter.isVoided = false;
          break;
        case 'upcoming':
          filter.paidDate = null;
          filter.isVoided = false;
          filter.dueDate = { $gte: now };
          break;
        case 'overdue':
          filter.paidDate = null;
          filter.isVoided = false;
          filter.dueDate = { $lt: now };
          break;
        case 'voided':
          filter.isVoided = true;
          break;
      }
    }
    return this.primaryModel.find(filter).sort({ dueDate: 1 }).populate(['tenantId', 'propertyId']).exec();
  }

  async findById(id: string): Promise<PaymentDocument> {
    const payment = await this.primaryModel.findById(id).populate(['tenantId', 'propertyId']).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  async collectPayment(id: string, dto: CollectPaymentDto): Promise<PaymentDocument> {
    
    const payment = await this.primaryModel.findById(new Types.ObjectId(id)).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.paidDate !== null) throw new BadRequestException('Payment already collected');
    if (payment.isVoided === true) throw new BadRequestException('Cannot collect a voided payment');

    const paidDate = dto.paidDate ? new Date(dto.paidDate) : new Date();
    payment.paidDate = paidDate;

    const [primaryResult, backupResult] = await Promise.allSettled([
      payment.save(),
      this.primaryModel.findByIdAndUpdate(new Types.ObjectId(id), { paidDate }).exec(),
      this.backupModel.findByIdAndUpdate(new Types.ObjectId(id), { paidDate }).exec(),
    ]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] collectPayment failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;

    await this.recomputePropertyStatus(payment.propertyId.toString());
    return primaryResult.value.populate(['tenantId', 'propertyId']);
  }

  async voidFuturePayments(contractId: string, afterDate: Date): Promise<void> {
    const filter = {
      contractId: new Types.ObjectId(contractId),
      dueDate: { $gt: afterDate },
      paidDate: null,
    };
    const update = { isVoided: true };

    const [primaryResult, backupResult] = await Promise.allSettled([
      this.primaryModel.updateMany(filter, update).exec(),
      this.backupModel.updateMany(filter, update).exec(),
    ]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] voidFuturePayments failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
  }

  async recomputePropertyStatus(propertyId: string): Promise<void> {
    const overdueCount = await this.primaryModel.countDocuments({
      propertyId: new Types.ObjectId(propertyId),
      paidDate: null,
      isVoided: false,
      dueDate: { $lt: new Date() },
    }).exec();

    if (overdueCount > 0) {
      await this.propertiesService.updateStatus(propertyId, PropertyStatus.OVERDUE);
    } else {
      await this.propertiesService.updateStatus(propertyId, PropertyStatus.RENTED);
    }
  }

  @Cron('0 0 * * *')
  async syncOverduePayments(): Promise<void> {
    const now = new Date();
    const overduePropertyIds = await this.primaryModel
      .find({ paidDate: null, isVoided: false, dueDate: { $lt: now } })
      .distinct('propertyId')
      .exec();

    const rentedPropertyIds = await this.primaryModel
      .find({ paidDate: { $ne: null }, isVoided: false })
      .distinct('propertyId')
      .exec();

    for (const id of overduePropertyIds) {
      await this.propertiesService.updateStatus(id.toString(), PropertyStatus.OVERDUE);
    }

    for (const id of rentedPropertyIds) {
      if (!overduePropertyIds.some((o) => o.equals(id))) {
        await this.propertiesService.updateStatus(id.toString(), PropertyStatus.RENTED);
      }
    }
  }
}
