import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Payment.name, 'primary') private paymentModel: Model<PaymentDocument>,
  ) {}

  async getSummary(year: number) {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year + 1, 0, 1);
    const now = new Date();

    const payments = await this.paymentModel.find({
      dueDate: { $gte: startOfYear, $lt: endOfYear },
      isVoided: { $ne: true },
    }).exec();

    let ytdRevenue = 0;
    let collected = 0;
    let pending = 0;
    let overdue = 0;

    for (const p of payments) {
      ytdRevenue += p.amount;
      if (p.paidDate !== null) collected += p.amount;
      else if (p.paidDate === null && p.dueDate >= now) pending += p.amount;
      else if (p.paidDate === null && p.dueDate < now) overdue += p.amount;
    }

    const collectedPercent = ytdRevenue > 0 ? Math.round((collected / ytdRevenue) * 100) : 0;
    return { ytdRevenue, collected, pending, overdue, collectedPercent };
  }

  async getMonthly(months: number) {
    const now = new Date();
    const data: { month: string; amount: number }[] = [];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);

      const result = await this.paymentModel.aggregate([
        {
          $match: {
            dueDate: { $gte: start, $lt: end },
            paidDate: { $ne: null },
            isVoided: { $ne: true },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]).exec();

      data.push({ month: monthNames[d.getMonth()], amount: result[0]?.total ?? 0 });
    }

    return { data };
  }

  async getBreakdown() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const result = await this.paymentModel.aggregate([
      {
        $match: {
          dueDate: { $gte: startOfMonth, $lt: endOfMonth },
          isVoided: { $ne: true },
        },
      },
      {
        $addFields: {
          derivedStatus: {
            $switch: {
              branches: [
                { case: { $ne: ['$paidDate', null] }, then: 'paid' },
                { case: { $lt: ['$dueDate', now] }, then: 'overdue' },
              ],
              default: 'upcoming',
            },
          },
        },
      },
      {
        $group: {
          _id: '$derivedStatus',
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
        },
      },
    ]).exec();

    const breakdown: Record<string, { count: number; amount: number }> = {};
    for (const r of result) {
      breakdown[r._id] = { count: r.count, amount: r.amount };
    }
    return breakdown;
  }
}
