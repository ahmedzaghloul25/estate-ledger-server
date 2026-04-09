import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ContractsService } from './contracts.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { TerminateContractDto } from './dto/terminate-contract.dto';

@Controller('contracts')
export class ContractsController {
  constructor(private contractsService: ContractsService) {}

  @Get()
  findAll(@Query('status') status?: string) {
    return this.contractsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contractsService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateContractDto) {
    return this.contractsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contractsService.update(id, dto);
  }

  @Patch(':id/terminate')
  terminate(@Param('id') id: string, @Body() dto: TerminateContractDto) {
    return this.contractsService.terminate(id, dto);
  }
}
