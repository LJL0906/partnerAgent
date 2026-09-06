import { v5 as uuidv5 } from 'uuid';
import {
  CHAT_PREVIEW_APPLIED,
  CHAT_PREVIEW_CONFIRMATION_STATUS,
  CHAT_PREVIEW_ERROR_CODES,
  CHAT_PREVIEW_MAX_ITEMS_PER_TASK,
  CHAT_PREVIEW_SCHEMA_VERSION,
  ChatPreviewValidationError,
  parseChatPreviewProposalV1,
  parseChatPreviewsV1,
  type ChatPreviewErrorCode,
  type ChatPreviewProposalV1,
  type ChatPreviewSourceRef,
  type ChatPreviewV1,
} from '@partner-agent/contracts';

const CHAT_PREVIEW_ID_NAMESPACE = 'f06c3380-2445-5d3f-8b94-e64f177f2a04';

export class StructuredPreviewOutputError extends Error {
  constructor(
    readonly code: ChatPreviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StructuredPreviewOutputError';
  }
}

export interface ChatPreviewOutputContext {
  taskId: string;
  allowedSourceRefs: ChatPreviewSourceRef[];
}

const sourceKey = (source: ChatPreviewSourceRef) =>
  `${source.kind}:${source.id}`;

export class ChatPreviewOutputCollector {
  private readonly previews: ChatPreviewV1[] = [];
  private readonly observedToolCalls = new Set<string>();
  private readonly rejectedToolCalls = new Set<string>();
  private rejectedAttempts = 0;
  private pendingInvalidOutput = false;
  private correctionExhausted = false;
  private modelTurnActive = false;
  private rejectedInCurrentTurn = false;

  constructor(private readonly context: ChatPreviewOutputContext) {}

  beginModelTurn(): void {
    this.modelTurnActive = true;
    this.rejectedInCurrentTurn = false;
  }

  collect(value: unknown, toolCallId?: string): ChatPreviewV1 {
    if (toolCallId) this.observedToolCalls.add(toolCallId);
    if (this.correctionExhausted) throw this.invalidError();

    try {
      const proposal = parseChatPreviewProposalV1(value);
      const sources = this.resolveSources(proposal);
      const preview: ChatPreviewV1 = {
        schema_version: CHAT_PREVIEW_SCHEMA_VERSION,
        preview_id: uuidv5(
          `${this.context.taskId}:${this.previews.length}`,
          CHAT_PREVIEW_ID_NAMESPACE,
        ),
        kind: 'action',
        confirmation_status: CHAT_PREVIEW_CONFIRMATION_STATUS,
        applied: CHAT_PREVIEW_APPLIED,
        source_refs: sources,
        content: structuredClone(proposal.content),
        warnings: [],
      };
      parseChatPreviewsV1([...this.previews, preview]);
      this.previews.push(preview);
      this.pendingInvalidOutput = false;
      return structuredClone(preview);
    } catch (error) {
      this.noteRejectedAttempt(toolCallId);
      if (error instanceof StructuredPreviewOutputError) throw error;
      if (error instanceof ChatPreviewValidationError) {
        throw new StructuredPreviewOutputError(
          error.issues[0]?.code ?? CHAT_PREVIEW_ERROR_CODES.INVALID,
          '结构化预览未通过安全契约校验。',
        );
      }
      throw new StructuredPreviewOutputError(
        CHAT_PREVIEW_ERROR_CODES.INVALID,
        '结构化预览未通过安全契约校验。',
      );
    }
  }

  noteRejectedAttempt(toolCallId?: string): 'retry' | 'exhausted' {
    if (toolCallId && this.rejectedToolCalls.has(toolCallId)) {
      return this.correctionExhausted ? 'exhausted' : 'retry';
    }
    if (toolCallId) {
      this.observedToolCalls.add(toolCallId);
      this.rejectedToolCalls.add(toolCallId);
    }
    if (this.modelTurnActive && this.rejectedInCurrentTurn) {
      return this.correctionExhausted ? 'exhausted' : 'retry';
    }
    this.rejectedInCurrentTurn = true;
    this.rejectedAttempts += 1;
    this.pendingInvalidOutput = true;
    if (this.rejectedAttempts > 1) this.correctionExhausted = true;
    return this.correctionExhausted ? 'exhausted' : 'retry';
  }

  hasObservedToolCall(toolCallId: string): boolean {
    return this.observedToolCalls.has(toolCallId);
  }

  shouldTerminateCorrection(): boolean {
    return this.correctionExhausted;
  }

  canRequestMissingCorrection(): boolean {
    return this.rejectedAttempts === 0 && !this.correctionExhausted;
  }

  complete(options: { allowEmpty?: boolean } = {}): ChatPreviewV1[] {
    if (this.correctionExhausted || this.pendingInvalidOutput) {
      throw this.invalidError();
    }
    if (this.previews.length === 0 && !options.allowEmpty) {
      throw new StructuredPreviewOutputError(
        CHAT_PREVIEW_ERROR_CODES.MISSING,
        '结构化预览任务未产生 emit_chat_preview 输出。',
      );
    }
    return this.snapshot();
  }

  snapshot(): ChatPreviewV1[] {
    return structuredClone(this.previews);
  }

  get count(): number {
    return this.previews.length;
  }

  private resolveSources(
    proposal: ChatPreviewProposalV1,
  ): ChatPreviewSourceRef[] {
    const allowed = new Set(this.context.allowedSourceRefs.map(sourceKey));
    const suggestedSources = proposal.source_refs ?? [];
    if (
      this.context.allowedSourceRefs.length === 0 ||
      suggestedSources.some((source) => !allowed.has(sourceKey(source)))
    ) {
      throw new StructuredPreviewOutputError(
        CHAT_PREVIEW_ERROR_CODES.SOURCE_INVALID,
        '结构化预览来源不属于当前任务输入。',
      );
    }
    // Source identity is server-owned. Model suggestions may only be used for
    // validation; the persisted preview always carries the full authoritative
    // input set, including the current user message required for traceability.
    return structuredClone(this.context.allowedSourceRefs);
  }

  private invalidError(): StructuredPreviewOutputError {
    return new StructuredPreviewOutputError(
      CHAT_PREVIEW_ERROR_CODES.INVALID,
      '结构化预览输出非法，且纠正机会已用尽。',
    );
  }
}

export const CHAT_PREVIEW_OUTPUT_LIMIT = CHAT_PREVIEW_MAX_ITEMS_PER_TASK;
