import { Module } from '@nestjs/common';
import { ModelGatewayService } from './model-gateway.service.js';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { ExternalRequestBuilder } from './external-request.builder.js';
import { DatabaseModule } from '../database/database.module.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    ExternalRequestBuilder,
    EgressPolicyGateway,
    ModelGatewayService,
  ],
  exports: [ModelGatewayService, EgressPolicyGateway],
})
export class ModelGatewayModule {}
