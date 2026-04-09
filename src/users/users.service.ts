import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name, 'primary') private primaryModel: Model<UserDocument>,
    @InjectModel(User.name, 'backup') private backupModel: Model<UserDocument>,
  ) {}

  private async dualWrite<T>(
    primaryOp: () => Promise<T>,
    backupOp: () => Promise<unknown>,
  ): Promise<T> {
    const [primaryResult, backupResult] = await Promise.allSettled([primaryOp(), backupOp()]);
    if (backupResult.status === 'rejected') {
      console.error('[Backup DB] users write failed:', backupResult.reason);
    }
    if (primaryResult.status === 'rejected') throw primaryResult.reason;
    return primaryResult.value;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.primaryModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.primaryModel.findById(id).exec();
  }

  async create(data: { email: string; password: string; name: string }): Promise<UserDocument> {
    const hashedPassword = await bcrypt.hash(data.password, 10)
    data.password = hashedPassword
    return this.dualWrite(
      () => new this.primaryModel(data).save(),
      () => new this.backupModel(data).save(),
    );
  }
}
