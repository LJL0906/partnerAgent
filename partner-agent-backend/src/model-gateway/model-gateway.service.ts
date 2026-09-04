import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createModels,
  type MutableModels,
} from '@earendil-works/pi-ai';
import { deepseekProvider } from '@earendil-works/pi-ai/providers/deepseek';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';

@Injectable()
export class ModelGatewayService implements OnModuleInit {
  private readonly logger = new Logger(ModelGatewayService.name);
  private models?: MutableModels;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const models = createModels();

    models.setProvider(deepseekProvider());

    if (this.configService.get<string>('ANTHROPIC_API_KEY')) {
      models.setProvider(anthropicProvider());
    }

    if (this.configService.get<string>('OPENAI_API_KEY')) {
      models.setProvider(openaiProvider());
    }

    this.models = models;

    const provider = this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelCount = models.getModels(provider).length;
    this.logger.log(`Model Gateway 初始化完成: ${provider} (${modelCount} 个模型)`);
  }

  getModels(): MutableModels {
    if (!this.models) {
      throw new Error('Model Gateway 尚未初始化');
    }

    return this.models;
  }
}