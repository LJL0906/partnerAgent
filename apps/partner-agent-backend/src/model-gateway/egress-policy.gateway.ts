import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Context, SimpleStreamOptions, Tool } from '@earendil-works/pi-ai';
import {
  EgressDecisionError,
  type ApprovedEgressRequest,
  type EgressPolicyResult,
  type ExternalModelRequest,
  type SensitiveCategory,
} from './egress.types.js';
import {
  EGRESS_DECISION_STORE,
  type EgressDecisionStore,
  type StoredEgressDecision,
} from './egress-decision.store.js';
import { EgressAuditStore } from '../database/egress-audit.store.js';
import { SensitiveDataScanner } from './sensitive-data-scanner.js';
import { SensitiveDataRedactor } from './sensitive-data-redactor.js';
import {
  DEFAULT_FINGERPRINT_MAX_BYTES,
  fingerprintExternalPayload,
} from './external-request-fingerprint.js';

type EvaluatedEgressResult = Omit<EgressPolicyResult, 'request'> & {
  approvedInput?: ExternalModelRequest;
};
@Injectable()
export class EgressPolicyGateway {
  private readonly scanner = new SensitiveDataScanner();
  private readonly redactor = new SensitiveDataRedactor();
  constructor(
    private readonly config: ConfigService,
    private readonly auditSink: EgressAuditStore,
    @Inject(EGRESS_DECISION_STORE)
    private readonly decisions: EgressDecisionStore,
  ) {}
  async evaluate(input: ExternalModelRequest): Promise<EgressPolicyResult> {
    let categories: SensitiveCategory[] = [];
    let fingerprint: string | undefined;
    let result: EvaluatedEgressResult = { decision: 'blocked', categories };
    try {
      const payload = this.semanticPayload(input);
      const scanned = this.scanner.scan(payload);
      if (!scanned.ok) {
        result = { decision: 'blocked', categories };
      } else {
        categories = scanned.categories;
        fingerprint = fingerprintExternalPayload(
          payload,
          this.fingerprintLimit(),
        );
        const configuredDecision = this.decide(categories);
        result =
          configuredDecision === 'pending_user_decision'
            ? await this.evaluatePendingDecision(
                input,
                fingerprint,
                categories,
              )
            : this.completeConfiguredDecision(
                input,
                configuredDecision,
                categories,
              );
      }
    } catch {
      result = { decision: 'blocked', categories };
    }

    fingerprint ??= this.unavailableFingerprint(input);
    try {
      await this.audit(input, result, fingerprint);
    } catch {
      throw new EgressDecisionError('blocked', categories, {
        reason: 'audit_unavailable',
        provider: input.metadata.provider,
        modelId: input.model.id,
        requestFingerprint: fingerprint,
      });
    }

    const { approvedInput, ...publicResult } = result;
    return {
      ...publicResult,
      requestFingerprint: fingerprint,
      ...(approvedInput
        ? {
            request: this.approve(
              approvedInput,
              result.decision as 'allowed' | 'redacted',
              categories,
            ),
          }
        : {}),
    };
  }

  computeRequestFingerprint(input: ExternalModelRequest): string {
    return fingerprintExternalPayload(
      this.semanticPayload(input),
      this.fingerprintLimit(),
    );
  }

  private async evaluatePendingDecision(
    input: ExternalModelRequest,
    requestFingerprint: string,
    categories: SensitiveCategory[],
  ): Promise<EvaluatedEgressResult> {
    const { taskId, ownerId } = input.metadata;
    if (!taskId || !input.metadata.operationId) {
      return { decision: 'blocked', categories };
    }

    const current = await this.decisions.findCurrentForTask(taskId, ownerId);
    if (
      current?.state === 'pending' &&
      this.matches(current, input, requestFingerprint)
    ) {
      const checked = await this.decisions.consumeMatchingDecision({
        ownerId,
        taskId,
        requestFingerprint,
        provider: input.metadata.provider,
        modelId: input.model.id,
        source: input.metadata.source,
      });
      if (checked.status === 'pending' && checked.record) {
        return this.pendingResult(checked.record, categories);
      }
      if (['blocked', 'expired', 'cancelled'].includes(checked.status)) {
        return { decision: 'blocked', categories };
      }
      if (checked.status === 'consumed' && checked.record) {
        if (checked.record.decision === 'redact') {
          const approvedInput = this.redactAndRescan(input);
          return approvedInput
            ? { decision: 'redacted', categories, approvedInput }
            : { decision: 'blocked', categories };
        }
        return {
          decision: 'allowed',
          categories,
          approvedInput: input,
        };
      }
    }

    let redacted: ExternalModelRequest | undefined;
    if (
      current?.state === 'ready_redact' &&
      this.matches(current, input, requestFingerprint)
    ) {
      redacted = this.redactAndRescan(input);
      if (!redacted) return { decision: 'blocked', categories };
    }

    if (current?.state === 'ready_allow' || current?.state === 'ready_redact') {
      const consumed = await this.decisions.consumeMatchingDecision({
        ownerId,
        taskId,
        requestFingerprint,
        provider: input.metadata.provider,
        modelId: input.model.id,
        source: input.metadata.source,
      });
      if (consumed.status === 'consumed' && consumed.record) {
        if (consumed.record.decision === 'redact') {
          redacted ??= this.redactAndRescan(input);
          return redacted
            ? { decision: 'redacted', categories, approvedInput: redacted }
            : { decision: 'blocked', categories };
        }
        return {
          decision: 'allowed',
          categories,
          approvedInput: input,
        };
      }
      if (['blocked', 'expired', 'cancelled'].includes(consumed.status)) {
        return { decision: 'blocked', categories };
      }
    } else if (!current) {
      const terminal = await this.decisions.consumeMatchingDecision({
        ownerId,
        taskId,
        requestFingerprint,
        provider: input.metadata.provider,
        modelId: input.model.id,
        source: input.metadata.source,
      });
      if (['blocked', 'expired', 'cancelled'].includes(terminal.status)) {
        return { decision: 'blocked', categories };
      }
    }

    if (
      current &&
      ['blocked', 'expired', 'cancelled'].includes(current.state)
    ) {
      return { decision: 'blocked', categories };
    }

    const pending = await this.decisions.createOrGetPending({
      ownerId,
      taskId,
      sessionId: input.metadata.sessionId,
      operationId: input.metadata.operationId,
      requestFingerprint,
      provider: input.metadata.provider,
      modelId: input.model.id,
      source: input.metadata.source,
      categories,
      ttlMs: this.privacyDecisionTtlMs(),
    });
    return this.pendingResult(pending, categories);
  }

  private completeConfiguredDecision(
    input: ExternalModelRequest,
    decision: Exclude<EgressPolicyResult['decision'], 'pending_user_decision'>,
    categories: SensitiveCategory[],
  ): EvaluatedEgressResult {
    if (decision === 'blocked') return { decision, categories };
    if (decision === 'redacted') {
      const approvedInput = this.redactAndRescan(input);
      return approvedInput
        ? { decision, categories, approvedInput }
        : { decision: 'blocked', categories };
    }
    return {
      decision,
      categories,
      approvedInput: input,
    };
  }

  private redactAndRescan(
    input: ExternalModelRequest,
  ): ExternalModelRequest | undefined {
    const redacted = this.redactor.redact({
      context: this.providerContext(input.context),
      options: this.providerOptions(input.options),
    });
    if (!redacted.ok) return undefined;
    const payload = redacted.value as {
      context: Context;
      options?: SimpleStreamOptions;
    };
    const redactedInput: ExternalModelRequest = {
      ...input,
      context: payload.context,
      options: input.options
        ? ({ ...input.options, ...payload.options } as SimpleStreamOptions)
        : undefined,
    };
    const rescanned = this.scanner.scan(this.semanticPayload(redactedInput));
    if (!rescanned.ok || rescanned.findings.length > 0) return undefined;
    return redactedInput;
  }

  private approve(
    input: ExternalModelRequest,
    decision: 'allowed' | 'redacted',
    categories: SensitiveCategory[],
  ): ApprovedEgressRequest {
    return {
      ...input,
      decision,
      categories,
    } as unknown as ApprovedEgressRequest;
  }

  private pendingResult(
    record: StoredEgressDecision,
    categories: SensitiveCategory[],
  ): EgressPolicyResult {
    return {
      decision: 'pending_user_decision',
      categories,
      egressId: record.id,
      expiresAt: record.expiresAt,
    };
  }

  private matches(
    record: StoredEgressDecision,
    input: ExternalModelRequest,
    fingerprint: string,
  ): boolean {
    return (
      record.requestFingerprint === fingerprint &&
      record.provider === input.metadata.provider &&
      record.modelId === input.model.id &&
      record.source === input.metadata.source
    );
  }

  private semanticPayload(input: ExternalModelRequest): unknown {
    return {
      provider: input.metadata.provider,
      modelId: input.model.id,
      context: this.providerContext(input.context),
      options: this.providerOptions(input.options),
      source: input.metadata.source,
      taskRef: {
        taskId: input.metadata.taskId ?? null,
        sessionId: input.metadata.sessionId,
        operationId: input.metadata.operationId ?? null,
      },
    };
  }

  private providerContext(context: Context): Context {
    return {
      ...(context.systemPrompt === undefined
        ? {}
        : { systemPrompt: context.systemPrompt }),
      messages: context.messages,
      ...(context.tools === undefined
        ? {}
        : {
            tools: context.tools.map((tool: Tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              ...(tool.constrainedSampling === undefined
                ? {}
                : { constrainedSampling: tool.constrainedSampling }),
            })),
          }),
    };
  }

  private providerOptions(
    options?: SimpleStreamOptions,
  ): Record<string, unknown> | undefined {
    if (!options) return undefined;
    const source = options as Record<string, unknown>;
    const keys = [
      'temperature',
      'apiKey',
      'samplingParams',
      'maxTokens',
      'transport',
      'cacheRetention',
      'sessionId',
      'websocketConnectTimeoutMs',
      'metadata',
      'headers',
      'timeoutMs',
      'maxRetries',
      'maxRetryDelayMs',
      'toolChoice',
      'reasoning',
      'deferred',
      'thinkingBudgets',
      'env',
    ];
    return Object.fromEntries(
      keys.flatMap((key) =>
        source[key] === undefined ? [] : [[key, source[key]]],
      ),
    );
  }

  private decide(
    categories: SensitiveCategory[],
  ): EgressPolicyResult['decision'] {
    if (categories.length === 0) return 'allowed';
    const forbidden = new Set(
      (this.config.get<string>('EGRESS_FORBIDDEN_CATEGORIES') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (categories.some((category) => forbidden.has(category)))
      return 'blocked';
    const action =
      this.config.get<string>('EGRESS_SENSITIVE_ACTION') ?? 'redact';
    if (action === 'allow') return 'allowed';
    if (action === 'ask') return 'pending_user_decision';
    if (action === 'block') return 'blocked';
    if (action === 'redact') return 'redacted';
    throw new Error('invalid egress policy');
  }

  private privacyDecisionTtlMs(): number {
    const configured = Number(
      this.config.get('PRIVACY_DECISION_TTL_MS') ?? 900_000,
    );
    return Number.isSafeInteger(configured) && configured > 0
      ? configured
      : 900_000;
  }

  private fingerprintLimit(): number {
    const configured = Number(
      this.config.get('EGRESS_FINGERPRINT_MAX_BYTES') ??
        DEFAULT_FINGERPRINT_MAX_BYTES,
    );
    return Number.isSafeInteger(configured) && configured > 0
      ? configured
      : DEFAULT_FINGERPRINT_MAX_BYTES;
  }

  private unavailableFingerprint(input: ExternalModelRequest): string {
    return createHash('sha256')
      .update(input.metadata.ownerId)
      .update('\0')
      .update(input.metadata.sessionId)
      .update('\0')
      .update(input.metadata.taskId ?? '')
      .update('\0')
      .update(input.metadata.operationId ?? '')
      .update('\0')
      .update(input.metadata.provider)
      .update('\0')
      .update(input.model.id)
      .update('\0')
      .update(input.metadata.source)
      .digest('hex');
  }

  private async audit(
    input: ExternalModelRequest,
    result: EvaluatedEgressResult,
    requestFingerprint: string,
  ): Promise<void> {
    await this.auditSink.record({
      requestId: randomUUID(),
      egressId: result.egressId,
      ownerId: input.metadata.ownerId,
      sessionId: input.metadata.sessionId,
      taskId: input.metadata.taskId,
      operationId: input.metadata.operationId,
      requestFingerprint,
      source: input.metadata.source,
      provider: input.metadata.provider,
      modelId: input.model.id,
      categories: result.categories,
      decision: result.decision,
      createdAt: new Date(),
    });
  }
}
