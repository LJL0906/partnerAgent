import { Module } from '@nestjs/common';
import { ModelGatewayService } from './model-gateway.service.js';
import { EgressPolicyGateway } from './egress-policy.gateway.js';
import { ExternalRequestBuilder } from './external-request.builder.js';
import { DatabaseModule } from '../database/database.module.js';
import {
  ModelGatewayObserver,
  NoopModelGatewayObserver,
} from './model-gateway-reliability.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    ExternalRequestBuilder,
    EgressPolicyGateway,
    { provide: ModelGatewayObserver, useClass: NoopModelGatewayObserver },
    ModelGatewayService,
  ],
  exports: [ModelGatewayService, EgressPolicyGateway, ModelGatewayObserver],
})
export class ModelGatewayModule {}
