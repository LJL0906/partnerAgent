import { Module } from '@nestjs/common';
import { ModelGatewayService } from './model-gateway.service.js';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { ExternalRequestBuilder } from './external-request.builder.js';
import { DatabaseModule } from '../database/database.module.js';
import { ObservabilityModule } from '../observability/observability.module.js';

@Module({
  imports: [DatabaseModule, ObservabilityModule],
  providers: [
    ExternalRequestBuilder,
    EgressPolicyGateway,
    ModelGatewayService,
  ],
  exports: [ModelGatewayService, EgressPolicyGateway],
})
export class ModelGatewayModule {}
