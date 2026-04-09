import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contract, ContractSchema } from './schemas/contract.schema';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { PaymentsModule } from '../payments/payments.module';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Contract.name, schema: ContractSchema }], 'primary'),
    MongooseModule.forFeature([{ name: Contract.name, schema: ContractSchema }], 'backup'),
    PaymentsModule,
    PropertiesModule,
  ],
  providers: [ContractsService],
  controllers: [ContractsController],
  exports: [ContractsService],
})
export class ContractsModule {}
