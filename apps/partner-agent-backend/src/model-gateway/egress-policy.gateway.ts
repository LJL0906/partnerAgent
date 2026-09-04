import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Context, SimpleStreamOptions, Tool } from '@earendil-works/pi-ai';
import type {
  ApprovedEgressRequest,
  EgressPolicyResult,
  ExternalModelRequest,
  SensitiveCategory,
} from './egress.types.js';
import {
  EGRESS_DECISION_STORE,
  type EgressDecisionStore,
  type StoredEgressDecision,
} from './egress-decision.store.js';
import { EgressAuditStore } from '../database/egress-audit.store.js';

const DEFAULT_FINGERPRINT_LIMIT = 1_048_576;
const MAX_SERIALIZATION_DEPTH = 64;

@Injectable()
export class EgressPolicyGateway {
  constructor(
    private readonly config: ConfigService,
    private readonly auditSink: EgressAuditStore,
    @Inject(EGRESS_DECISION_STORE)
    private readonly decisions: EgressDecisionStore,
  ) {}

  async evaluate(input: ExternalModelRequest): Promise<EgressPolicyResult> {
    let categories: SensitiveCategory[] = [];
    let fingerprint: string | undefined;
    try {
      const serialized = this.stableSerialize(this.semanticPayload(input));
      fingerprint = createHash('sha256').update(serialized).digest('hex');
      categories = this.scan(serialized);
      const configuredDecision = this.decide(categories);
      const result =
        configuredDecision === 'pending_user_decision'
          ? await this.evaluatePendingDecision(input, fingerprint, categories)
          : this.completeConfiguredDecision(
              input,
              configuredDecision,
              categories,
            );
      this.audit(input, result.decision, categories);
      return { ...result, requestFingerprint: fingerprint };
    } catch {
      this.audit(input, 'blocked', categories);
      return {
        decision: 'blocked',
        categories,
        requestFingerprint: fingerprint,
      };
    }
  }

  computeRequestFingerprint(input: ExternalModelRequest): string {
    return createHash('sha256')
      .update(this.stableSerialize(this.semanticPayload(input)))
      .digest('hex');
  }

  private async evaluatePendingDecision(
    input: ExternalModelRequest,
    requestFingerprint: string,
    categories: SensitiveCategory[],
  ): Promise<EgressPolicyResult> {
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
          const request = this.redactAndApprove(input, categories);
          return request
            ? { decision: 'redacted', categories, request }
            : { decision: 'blocked', categories };
        }
        return {
          decision: 'allowed',
          categories,
          request: this.approve(input, 'allowed', categories),
        };
      }
    }

    let redacted: ApprovedEgressRequest | undefined;
    if (
      current?.state === 'ready_redact' &&
      this.matches(current, input, requestFingerprint)
    ) {
      redacted = this.redactAndApprove(input, categories);
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
          redacted ??= this.redactAndApprove(input, categories);
          return redacted
            ? { decision: 'redacted', categories, request: redacted }
            : { decision: 'blocked', categories };
        }
        return {
          decision: 'allowed',
          categories,
          request: this.approve(input, 'allowed', categories),
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
  ): EgressPolicyResult {
    if (decision === 'blocked') return { decision, categories };
    if (decision === 'redacted') {
      const request = this.redactAndApprove(input, categories);
      return request
        ? { decision, categories, request }
        : { decision: 'blocked', categories };
    }
    return {
      decision,
      categories,
      request: this.approve(input, decision, categories),
    };
  }

  private redactAndApprove(
    input: ExternalModelRequest,
    categories: SensitiveCategory[],
  ): ApprovedEgressRequest | undefined {
    const redactedInput: ExternalModelRequest = {
      ...input,
      context: this.redactValue(this.providerContext(input.context)) as Context,
      options: this.redactOptions(input.options),
    };
    const rescanned = this.scan(
      this.stableSerialize(this.semanticPayload(redactedInput)),
    );
    if (rescanned.length > 0) return undefined;
    return this.approve(redactedInput, 'redacted', categories);
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

  private stableSerialize(value: unknown): string {
    const limit = this.fingerprintLimit();
    let bytes = 0;
    const ancestors = new Set<object>();
    const add = (part: string): string => {
      bytes += Buffer.byteLength(part);
      if (bytes > limit) throw new Error('fingerprint payload too large');
      return part;
    };
    const encode = (item: unknown, depth: number): string => {
      if (depth > MAX_SERIALIZATION_DEPTH)
        throw new Error('fingerprint depth exceeded');
      if (item === null) return add('null');
      if (typeof item === 'string') return add(JSON.stringify(item));
      if (typeof item === 'boolean') return add(item ? 'true' : 'false');
      if (typeof item === 'number') {
        if (!Number.isFinite(item)) throw new Error('non-finite number');
        return add(Object.is(item, -0) ? '0' : String(item));
      }
      if (typeof item === 'undefined') return add('null');
      if (typeof item !== 'object')
        throw new Error('unsupported fingerprint value');
      if (ancestors.has(item)) throw new Error('circular fingerprint value');
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        !Array.isArray(item)
      ) {
        throw new Error('unsupported fingerprint object');
      }
      ancestors.add(item);
      let encoded: string;
      if (Array.isArray(item)) {
        const parts = Array.from(item, (entry) => encode(entry, depth + 1));
        if (parts.length > 1) add(','.repeat(parts.length - 1));
        encoded = add('[') + parts.join(',') + add(']');
      } else {
        const object = item as Record<string, unknown>;
        const keys = Object.keys(object)
          .filter((key) => object[key] !== undefined)
          .sort();
        const parts = keys.map(
          (key) =>
            add(JSON.stringify(key)) +
            add(':') +
            encode(object[key], depth + 1),
        );
        if (parts.length > 1) add(','.repeat(parts.length - 1));
        encoded = add('{') + parts.join(',') + add('}');
      }
      ancestors.delete(item);
      return encoded;
    };
    return encode(value, 0);
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

  private scan(value: string): SensitiveCategory[] {
    const rules: Array<[SensitiveCategory, RegExp]> = [
      ['identity_document', /\b\d{17}[\dXx]\b/],
      ['bank_card', /\b(?:\d[ -]?){16,19}\b/],
      ['password', /(?:password|passwd|密码)\s*[:=]\s*[^\s,;]+/i],
      [
        'api_key',
        /(?:api[_-]?key|sk-[a-z0-9_-]{12,})\s*[:=]?\s*[a-z0-9_-]{8,}/i,
      ],
      ['secret', /(?:secret|token|密钥)\s*[:=]\s*[^\s,;]+/i],
    ];
    return rules
      .filter(([, rule]) => rule.test(value))
      .map(([category]) => category);
  }

  private redactOptions(
    options?: SimpleStreamOptions,
  ): SimpleStreamOptions | undefined {
    if (!options) return undefined;
    const result = { ...options } as Record<string, unknown>;
    for (const [key, value] of Object.entries(
      this.providerOptions(options) ?? {},
    )) {
      result[key] = this.redactValue(value);
    }
    return result as SimpleStreamOptions;
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === 'string') {
      return value.replace(
        /\b\d{17}[\dXx]\b|\b(?:\d[ -]?){16,19}\b|(?:password|passwd|密码|api[_-]?key|secret|token|密钥)\s*[:=]\s*[^\s,;"}]+|sk-[a-z0-9_-]{12,}/gi,
        '[REDACTED]',
      );
    }
    if (Array.isArray(value))
      return value.map((entry) => this.redactValue(entry));
    if (
      value &&
      typeof value === 'object' &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          this.redactValue(entry),
        ]),
      );
    }
    return value;
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
        DEFAULT_FINGERPRINT_LIMIT,
    );
    return Number.isSafeInteger(configured) && configured > 0
      ? configured
      : DEFAULT_FINGERPRINT_LIMIT;
  }

  private audit(
    input: ExternalModelRequest,
    decision: EgressPolicyResult['decision'],
    categories: SensitiveCategory[],
  ): void {
    this.auditSink.record({
      requestId: randomUUID(),
      taskId: input.metadata.taskId,
      source: input.metadata.source,
      provider: input.metadata.provider,
      categories,
      decision,
      createdAt: new Date(),
    });
  }
}
