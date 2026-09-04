import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { ModelGatewayService } from '../model-gateway/model-gateway.service.js';

type BackendAgentEvent = {
  type: string;
  data?: unknown;
  timestamp: number;
};

@Injectable()
export class PiAgentService implements OnModuleInit {
  private readonly logger = new Logger(PiAgentService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly modelGateway: ModelGatewayService,
  ) {}

  onModuleInit(): void {
    const provider = this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelCount = this.modelGateway.getModels().getModels(provider).length;
    this.logger.log(`Pi Agent 初始化完成: ${provider} (${modelCount} 个模型)`);
  }

  async *chat(message: string): AsyncGenerator<BackendAgentEvent> {
    const provider = this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const models = this.modelGateway.getModels();
    const modelId = this.configService.get<string>('DEFAULT_MODEL');
    const model = modelId ? models.getModel(provider, modelId) : models.getModels(provider)[0];

    if (!model) {
      const availableModels = models.getModels(provider).map((entry) => entry.id).join(', ');
      throw new Error(
        `模型未配置: ${provider}/${modelId ?? '<默认模型>'}。可用模型: ${availableModels || '<无>'}`,
      );
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: '你是一个友好的个人助手。请使用中文回答，回答清晰、准确、简洁。',
        model,
        messages: [],
        tools: [],
      },
      streamFn: models.streamSimple.bind(models),
    });

    const pending: BackendAgentEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    let failed = false;
    let runError: unknown;

    const push = (event: BackendAgentEvent): void => {
      pending.push(event);
      wake?.();
      wake = undefined;
    };

    const unsubscribe = agent.subscribe((event) => {
      const mapped = this.mapAgentEvent(event, () => {
        failed = true;
      });
      if (mapped && !(event.type === 'agent_end' && failed)) {
        push(mapped);
      }
      if (event.type === 'agent_end') {
        ended = true;
        wake?.();
        wake = undefined;
      }
    });

    try {
      const promptPromise = agent.prompt(message).catch((error: unknown) => {
        runError = error;
        failed = true;
        ended = true;
        push({
          type: 'error',
          data: { message: error instanceof Error ? error.message : String(error) },
          timestamp: Date.now(),
        });
      });

      while (!ended || pending.length > 0) {
        if (pending.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        yield pending.shift()!;
      }

      await promptPromise;

      if (runError) {
        return;
      }

      if (!failed) {
        await agent.waitForIdle();
      }
    } finally {
      unsubscribe();
      if (!ended) {
        agent.abort();
      }
    }
  }

  private mapAgentEvent(event: AgentEvent, markFailed: () => void): BackendAgentEvent | undefined {
    const timestamp = Date.now();

    if (event.type === 'message_update') {
      const assistantEvent = event.assistantMessageEvent;
      if (assistantEvent.type === 'text_delta') {
        return { type: 'text_delta', data: assistantEvent.delta, timestamp };
      }
      if (assistantEvent.type === 'thinking_delta') {
        return { type: 'thinking_delta', data: assistantEvent.delta, timestamp };
      }
    }

    if (event.type === 'tool_execution_start') {
      return {
        type: 'tool_execution_start',
        data: { tool: event.toolName, toolCallId: event.toolCallId },
        timestamp,
      };
    }

    if (event.type === 'tool_execution_end') {
      return {
        type: 'tool_execution_end',
        data: { tool: event.toolName, toolCallId: event.toolCallId, result: event.result },
        timestamp,
      };
    }

    if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.errorMessage) {
      markFailed();
      return {
        type: 'error',
        data: { message: event.message.errorMessage },
        timestamp,
      };
    }

    if (event.type === 'agent_end') {
      return { type: 'done', timestamp };
    }

    return undefined;
  }
}