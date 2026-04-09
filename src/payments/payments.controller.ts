import { Controller, Get, Patch, Param, Body, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CollectPaymentDto } from './dto/collect-payment.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private paymentsService: PaymentsService) {}

  @Get()
  findAll(@Query('contractId') contractId?: string, @Query('status') status?: string) {
    return this.paymentsService.findAll({ contractId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findById(id);
  }

  @Patch(':id/collect')
  collect(@Param('id') id: string, @Body() dto: CollectPaymentDto) {
    return this.paymentsService.collectPayment(id, dto);
  }
}
