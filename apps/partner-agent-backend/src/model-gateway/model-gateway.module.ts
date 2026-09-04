import { Module } from '@nestjs/common';
import { ModelGatewayService } from './model-gateway.service.js';

@Module({
  providers: [ModelGatewayService],
  exports: [ModelGatewayService],
})
export class ModelGatewayModule {}