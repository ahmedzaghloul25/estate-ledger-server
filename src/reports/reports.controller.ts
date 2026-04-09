import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Get('summary')
  getSummary(@Query('year') year?: string) {
    const y = year ? Math.min(Math.max(parseInt(year, 10) || new Date().getFullYear(), 2000), 2100) : new Date().getFullYear();
    return this.reportsService.getSummary(y);
  }

  @Get('monthly')
  getMonthly(@Query('months') months?: string) {
    const m = months ? Math.min(Math.max(parseInt(months, 10) || 6, 1), 24) : 6;
    return this.reportsService.getMonthly(m);
  }

  @Get('breakdown')
  getBreakdown() {
    return this.reportsService.getBreakdown();
  }
}
