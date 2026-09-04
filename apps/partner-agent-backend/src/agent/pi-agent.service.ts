import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { ModelGatewayService } from '../model-gateway/model-gateway.service.js';
import { EgressDecisionError } from '../model-gateway/egress.types.js';
import { SessionManager } from './session-manager.service.js';
import { ToolExecutionService } from '../tools/tool-execution.service.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import {
  guardApprovalToolBatch,
  buildDirectChatContext,
  isPendingApprovalToolResult,
  replaceToolDecision,
  trimCompleteTurns,
  type PiToolDecision,
} from './pi-agent-context.js';
import {
  AgentRuntimeBudgetExceededError,
  readAgentRuntimePolicy,
  type AgentRuntimePolicy,
} from './agent-runtime-policy.js';
import {
  AgentRuntimeTelemetry,
  type AgentRunTrace,
} from './agent-runtime-telemetry.js';
import { mapPiAgentEvent, type BackendAgentEvent } from './pi-agent-events.js';
import {
  createBudgetedAgentStream,
  startAgentRunTrace,
  type PiChatContext,
} from './agent-runtime-stream.js';

export type { PiToolDecision } from './pi-agent-context.js';

export type { BackendAgentEvent } from './pi-agent-events.js';

export type { PiChatContext } from './agent-runtime-stream.js';

@Injectable()
export class PiAgentService implements OnModuleInit {
  private readonly logger = new Logger(PiAgentService.name);
  private readonly runtimePolicy: AgentRuntimePolicy;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelGateway: ModelGatewayService,
    private readonly sessionManager: SessionManager,
    private readonly toolExecution: ToolExecutionService,
    private readonly toolRegistry: ToolRegistryService,
    @Optional()
    private readonly runtimeTelemetry: AgentRuntimeTelemetry = new AgentRuntimeTelemetry(),
  ) {
    this.runtimePolicy = readAgentRuntimePolicy((key) =>
      this.configService.get<string | number>(key),
    );
  }

  onModuleInit(): void {
    const provider =
      this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelCount = this.availableModels(provider).length;
    this.logger.log(`Pi Agent 初始化完成: ${provider} (${modelCount} 个模型)`);
  }

  async *chat(
    sessionId: string,
    message: string,
    userId: string,
    context: PiChatContext = {},
  ): AsyncGenerator<BackendAgentEvent> {
    const provider =
      this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelId = this.configService.get<string>('DEFAULT_MODEL');
    const model = this.resolveModel(provider, modelId);

    if (!model) {
      const availableModels = this.availableModels(provider)
        .map((entry) => entry.id)
        .join(', ');
      throw new Error(
        `模型未配置: ${provider}/${modelId ?? '<默认模型>'}。可用模型: ${availableModels || '<无>'}`,
      );
    }

    const session = await this.sessionManager.getOrCreate(sessionId, userId);
    const contextMessages = context.taskId
      ? [...session.contextMessages]
      : this.contextForDirectChat(session, message, model);
    if (session.agent?.state.isStreaming) {
      throw new Error(`会话 ${sessionId} 已有请求正在处理中`);
    }
    const trace = startAgentRunTrace(
      this.runtimeTelemetry,
      this.runtimePolicy,
      userId,
      sessionId,
      context,
      'chat',
    );
    const agent = this.createAgent(
      sessionId,
      contextMessages,
      model,
      userId,
      context,
      trace,
    );
    await this.sessionManager.setAgent(sessionId, userId, agent);
    if (!context.taskId) {
      await this.sessionManager.saveMessage(sessionId, userId, 'user', message);
    }

    yield* this.runAgent(agent, sessionId, userId, trace, () =>
      agent.prompt(message),
    );
  }

  async *continueAfterToolDecision(
    sessionId: string,
    userId: string,
    decision: PiToolDecision,
    context: PiChatContext = {},
  ): AsyncGenerator<BackendAgentEvent> {
    const provider =
      this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelId = this.configService.get<string>('DEFAULT_MODEL');
    const model = this.resolveModel(provider, modelId);
    if (!model) throw new Error('模型未配置，无法继续工具审批后的 Agent 回合');

    const session = await this.sessionManager.getOrCreate(sessionId, userId);
    const contextMessages = context.taskId
      ? [...session.contextMessages]
      : this.contextForDirectChat(session, undefined, model);
    if (session.agent?.state.isStreaming) {
      throw new Error(`会话 ${sessionId} 已有请求正在处理中`);
    }
    const trace = startAgentRunTrace(
      this.runtimeTelemetry,
      this.runtimePolicy,
      userId,
      sessionId,
      context,
      'tool_decision',
    );
    const agent = this.createAgent(
      sessionId,
      contextMessages,
      model,
      userId,
      context,
      trace,
    );
    await this.sessionManager.setAgent(sessionId, userId, agent);

    const messages = replaceToolDecision(agent.state.messages, decision);
    agent.state.messages = messages;
    // 外部副作用已经发生；必须先把审批结果写入会话快照，再请求下一轮模型。
    // 即使此后进程退出或模型失败，恢复时也不会丢失已执行的工具结果。
    await this.sessionManager.completeAssistantTurn(
      sessionId,
      userId,
      undefined,
      messages,
    );

    yield* this.runAgent(agent, sessionId, userId, trace, () =>
      agent.continue(),
    );
  }

  /**
   * 恢复持久 ChatTask：普通受理输入重新 prompt；已经持久化外部工具结果的
   * 任务从 toolResult 继续，避免隐私等待或进程退出后重放原始输入和副作用。
   */
  async *resumeTask(
    sessionId: string,
    message: string,
    userId: string,
    context: PiChatContext = {},
  ): AsyncGenerator<BackendAgentEvent> {
    const provider =
      this.configService.get<string>('DEFAULT_PROVIDER') ?? 'deepseek';
    const modelId = this.configService.get<string>('DEFAULT_MODEL');
    const model = this.resolveModel(provider, modelId);
    if (!model) {
      yield* this.chat(sessionId, message, userId, context);
      return;
    }
    const session = await this.sessionManager.getOrCreate(sessionId, userId);
    const contextMessages = context.taskId
      ? [...session.contextMessages]
      : this.contextForDirectChat(session, undefined, model);
    const last = contextMessages.at(-1);
    if (last?.role !== 'toolResult' || isPendingApprovalToolResult(last)) {
      yield* this.chat(sessionId, message, userId, context);
      return;
    }

    if (session.agent?.state.isStreaming) {
      throw new Error(`会话 ${sessionId} 已有请求正在处理中`);
    }
    const trace = startAgentRunTrace(
      this.runtimeTelemetry,
      this.runtimePolicy,
      userId,
      sessionId,
      context,
      'resume',
    );
    const agent = this.createAgent(
      sessionId,
      contextMessages,
      model,
      userId,
      context,
      trace,
    );
    await this.sessionManager.setAgent(sessionId, userId, agent);
    yield* this.runAgent(agent, sessionId, userId, trace, () =>
      agent.continue(),
    );
  }

  private async *runAgent(
    agent: Agent,
    sessionId: string,
    userId: string,
    trace: AgentRunTrace,
    start: () => Promise<void>,
  ): AsyncGenerator<BackendAgentEvent> {
    const pending: BackendAgentEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    let failed = false;
    let runError: unknown;
    let assistantText = '';
    let waitingForToolApproval = false;
    let waitingForPrivacyDecision = false;
    let cancelled = false;

    const push = (event: BackendAgentEvent): void => {
      pending.push(event);
      wake?.();
      wake = undefined;
    };

    const unsubscribe = agent.subscribe(async (event, signal) => {
      trace.budget.hooks().observeAgentEvent(event, signal);
      if (event.type === 'tool_execution_start') {
        trace.toolStarted(event.toolCallId, event.toolName);
      }
      if (event.type === 'tool_execution_end') {
        trace.toolFinished(event.toolCallId, event.toolName, !event.isError);
      }
      if (
        event.type === 'message_end' &&
        event.message.role === 'assistant' &&
        event.message.stopReason === 'aborted'
      ) {
        cancelled = !trace.budget.termination();
      }
      const mapped = mapPiAgentEvent(event, {
        isApprovalRequired: (toolName) =>
          this.toolRegistry.isToolApprovalRequired(toolName),
        riskLevelFor: (toolName) => this.toolRegistry.get(toolName).riskLevel,
        markFailed: () => {
          failed = true;
        },
        budgetStop: trace.budget.termination(),
      });
      if (mapped?.type === 'text_delta' && typeof mapped.data === 'string') {
        trace.firstToken();
        assistantText += mapped.data;
      }
      if (mapped?.type === 'tool_confirmation_pending') {
        waitingForToolApproval = true;
      }
      if (mapped && !(event.type === 'agent_end' && failed)) {
        push(mapped);
      }
      if (
        event.type === 'message_end' &&
        isPendingApprovalToolResult(event.message)
      ) {
        await this.sessionManager.completeAssistantTurn(
          sessionId,
          userId,
          undefined,
          agent.state.messages,
        );
      }
      if (event.type === 'agent_end') {
        ended = true;
        wake?.();
        wake = undefined;
      }
    });

    const deadlineTimer = setTimeout(() => {
      if (
        ended ||
        waitingForToolApproval ||
        waitingForPrivacyDecision ||
        agent.signal?.aborted
      ) {
        return;
      }
      if (trace.budget.checkDeadline()) agent.abort();
    }, trace.budget.remainingTimeMs());
    deadlineTimer.unref?.();

    try {
      const promptPromise = start().catch((error: unknown) => {
        runError = error;
        failed = true;
        ended = true;
        if (error instanceof AgentRuntimeBudgetExceededError) {
          push({
            type: 'error',
            data: { code: error.code, message: error.budget.message },
            timestamp: Date.now(),
          });
        } else if (
          error instanceof EgressDecisionError &&
          error.decision === 'pending_user_decision'
        ) {
          waitingForPrivacyDecision = true;
          push({
            type: 'privacy_decision_required',
            data: { result: error.decision, categories: error.categories },
            timestamp: Date.now(),
          });
        } else {
          push({
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
              ...(error instanceof EgressDecisionError
                ? { result: error.decision, categories: error.categories }
                : {}),
            },
            timestamp: Date.now(),
          });
        }
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
        agent.state.messages = trimCompleteTurns(agent.state.messages);
        await this.sessionManager.completeAssistantTurn(
          sessionId,
          userId,
          assistantText || undefined,
          agent.state.messages,
        );
      }
    } finally {
      clearTimeout(deadlineTimer);
      unsubscribe();
      if (!ended) {
        agent.abort();
      }
      this.sessionManager.clearAgent(sessionId);
      trace.finish(
        waitingForToolApproval
          ? 'waiting_tool_approval'
          : waitingForPrivacyDecision
            ? 'waiting_privacy_decision'
            : cancelled
              ? 'cancelled'
              : trace.budget.termination() || failed || runError || !ended
                ? 'failed'
                : 'completed',
        trace.budget.termination(),
      );
    }
  }

  async cancel(sessionId: string, userId: string): Promise<boolean> {
    const agent = await this.sessionManager.getAgent(sessionId, userId);
    if (!agent?.state.isStreaming) {
      return false;
    }
    agent.abort();
    this.sessionManager.clearAgent(sessionId);
    return true;
  }

  async hasToolDecisionContext(
    sessionId: string,
    userId: string,
    toolCallId: string,
    toolName: string,
  ): Promise<boolean> {
    const session = await this.sessionManager.getOrCreate(sessionId, userId);
    const messages = session.agent?.state.messages ?? session.contextMessages;
    return messages.some(
      (entry) =>
        entry.role === 'toolResult' &&
        entry.toolCallId === toolCallId &&
        entry.toolName === toolName,
    );
  }

  private createAgent(
    sessionId: string,
    messages: AgentMessage[],
    model: Model<any>,
    ownerId: string,
    context: PiChatContext,
    trace: AgentRunTrace,
  ): Agent {
    return new Agent({
      sessionId,
      initialState: {
        systemPrompt:
          '你是紫灵AI，一个友好的个人智能助手。请使用中文回答，回答清晰、准确、简洁。',
        model,
        messages,
        tools: this.toolExecution.createAgentTools({
          ownerId,
          sessionId,
          taskId: context.taskId,
          operationId: context.operationId,
        }),
      },
      streamFn: createBudgetedAgentStream(
        this.modelGateway,
        ownerId,
        sessionId,
        context,
        trace,
      ),
      beforeToolCall: async (toolContext, signal) =>
        (await trace.budget.hooks().beforeToolCall(toolContext, signal)) ??
        guardApprovalToolBatch(toolContext, (toolName) =>
          this.toolRegistry.isToolApprovalRequired(toolName),
        ),
      shouldStopAfterTurn: trace.budget.hooks().shouldStopAfterTurn,
    });
  }

  private availableModels(provider: string): readonly Model<any>[] {
    return this.modelGateway.listModels(provider);
  }

  private resolveModel(
    provider: string,
    modelId?: string,
  ): Model<any> | undefined {
    return this.modelGateway.resolveModel(provider, modelId);
  }

  private contextForDirectChat(
    session: Awaited<ReturnType<SessionManager['getOrCreate']>>,
    acceptedPrompt: string | undefined,
    model: Model<any>,
  ): AgentMessage[] {
    return buildDirectChatContext(session, acceptedPrompt, model);
  }
}
