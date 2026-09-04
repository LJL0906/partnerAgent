import type { DataSource } from 'typeorm';
import type { EgressAuditRecord } from '../model-gateway/egress.types.js';
import { EgressAuditEntity } from './entities/egress-audit.entity.js';

export abstract class EgressAuditStore {
  abstract record(audit: EgressAuditRecord): Promise<void>;
}

export class MemoryEgressAuditStore extends EgressAuditStore {
  readonly records: EgressAuditRecord[] = [];
  async record(audit: EgressAuditRecord): Promise<void> {
    this.records.push(structuredClone(audit));
  }
}

/** 直接等待落库，避免外发载荷或命中明文进入审计对象。 */
export class TypeOrmEgressAuditStore extends EgressAuditStore {
  constructor(private readonly dataSource: DataSource) {
    super();
  }

  async record(audit: EgressAuditRecord): Promise<void> {
    await this.dataSource.getRepository(EgressAuditEntity).insert({
      requestId: audit.requestId,
      egressId: audit.egressId ?? null,
      ownerId: audit.ownerId,
      sessionId: audit.sessionId,
      taskId: audit.taskId ?? null,
      operationId: audit.operationId ?? null,
      requestFingerprint: audit.requestFingerprint,
      source: audit.source,
      provider: audit.provider,
      modelId: audit.modelId,
      categories: [...audit.categories],
      policyResult: audit.decision,
      createdAt: audit.createdAt,
    });
  }
}
