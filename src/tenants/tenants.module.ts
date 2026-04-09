import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Tenant, TenantSchema } from './schemas/tenant.schema';
import { Contract, ContractSchema } from '../contracts/schemas/contract.schema';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }], 'primary'),
    MongooseModule.forFeature([{ name: Tenant.name, schema: TenantSchema }], 'backup'),
    MongooseModule.forFeature([{ name: Contract.name, schema: ContractSchema }], 'primary'),
  ],
  providers: [TenantsService],
  controllers: [TenantsController],
  exports: [TenantsService],
})
export class TenantsModule {}
