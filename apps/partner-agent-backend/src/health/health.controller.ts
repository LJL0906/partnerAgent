import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HealthStateService } from './health-state.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthState: HealthStateService) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<{ status: 'ready' }> {
    if (!(await this.healthState.isReady())) {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
    return { status: 'ready' };
  }
}
