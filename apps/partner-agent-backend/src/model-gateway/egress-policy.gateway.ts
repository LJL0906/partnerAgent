import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Context } from '@earendil-works/pi-ai';
import type {
  ApprovedEgressRequest,
  EgressPolicyResult,
  ExternalModelRequest,
  SensitiveCategory,
} from './egress.types.js';
import { EgressAuditStore } from '../database/egress-audit.store.js';

@Injectable()
export class EgressPolicyGateway {
  constructor(
    private readonly config: ConfigService,
    private readonly auditSink: EgressAuditStore,
  ) {}

  evaluate(input: ExternalModelRequest): EgressPolicyResult {
    try {
      const serialized = JSON.stringify(input.context);
      const categories = this.scan(serialized);
      const decision = this.decide(categories);
      const processed = decision === 'redacted'
        ? { ...input, context: this.redactContext(input.context) }
        : input;
      this.auditSink.record({
        requestId: randomUUID(),
        taskId: input.metadata.taskId,
        source: input.metadata.source,
        provider: input.metadata.provider,
        categories,
        decision,
        createdAt: new Date(),
      });
      return decision === 'allowed' || decision === 'redacted'
        ? {
            decision,
            categories,
            request: {
              ...processed,
              decision,
              categories,
            } as unknown as ApprovedEgressRequest,
          }
        : { decision, categories };
    } catch {
      this.auditSink.record({
        requestId: randomUUID(),
        taskId: input.metadata.taskId,
        source: input.metadata.source,
        provider: input.metadata.provider,
        categories: [],
        decision: 'blocked',
        createdAt: new Date(),
      });
      return { decision: 'blocked', categories: [] };
    }
  }

  private decide(categories: SensitiveCategory[]): EgressPolicyResult['decision'] {
    if (categories.length === 0) return 'allowed';
    const forbidden = new Set(
      (this.config.get<string>('EGRESS_FORBIDDEN_CATEGORIES') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (categories.some((category) => forbidden.has(category))) return 'blocked';
    const action = this.config.get<string>('EGRESS_SENSITIVE_ACTION') ?? 'redact';
    if (action === 'allow') return 'allowed';
    if (action === 'ask') return 'pending_user_decision';
    if (action === 'block') return 'blocked';
    if (action !== 'redact') throw new Error('invalid egress policy');
    return 'redacted';
  }

  private scan(value: string): SensitiveCategory[] {
    const rules: Array<[SensitiveCategory, RegExp]> = [
      ['identity_document', /\b\d{17}[\dXx]\b/g],
      ['bank_card', /\b(?:\d[ -]?){16,19}\b/g],
      ['password', /(?:password|passwd|密码)\s*[:=]\s*[^\s,;]+/gi],
      ['api_key', /(?:api[_-]?key|sk-[a-z0-9_-]{12,})\s*[:=]?\s*[a-z0-9_-]{8,}/gi],
      ['secret', /(?:secret|token|密钥)\s*[:=]\s*[^\s,;]+/gi],
    ];
    return rules.filter(([, rule]) => rule.test(value)).map(([category]) => category);
  }

  private redactContext(context: Context): Context {
    const json = JSON.stringify(context).replace(
      /\b\d{17}[\dXx]\b|\b(?:\d[ -]?){16,19}\b|(?:password|passwd|密码|api[_-]?key|secret|token|密钥)\s*[:=]\s*[^\s,;"}]+|sk-[a-z0-9_-]{12,}/gi,
      '[REDACTED]',
    );
    return JSON.parse(json) as Context;
  }
}
