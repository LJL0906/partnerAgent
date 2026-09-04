import type { OnModuleDestroy } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { EgressAuditRecord } from '../model-gateway/egress.types.js';
import { EgressAuditEntity } from './entities/egress-audit.entity.js';

export abstract class EgressAuditStore {
  abstract record(audit: EgressAuditRecord): void;
}

export class MemoryEgressAuditStore extends EgressAuditStore {
  readonly records: EgressAuditRecord[] = [];
  record(audit: EgressAuditRecord): void {
    this.records.push(structuredClone(audit));
  }
}

/** 串行落库，避免外发载荷或命中明文进入审计对象。 */
export class TypeOrmEgressAuditStore
  extends EgressAuditStore
  implements OnModuleDestroy
{
  private pending = Promise.resolve();

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  record(audit: EgressAuditRecord): void {
    this.pending = this.pending.then(async () => {
      await this.dataSource.getRepository(EgressAuditEntity).insert({
        requestId: audit.requestId,
        taskId: audit.taskId ?? null,
        source: audit.source,
        categories: [...audit.categories],
        policyResult: audit.decision,
        provider: audit.provider,
        createdAt: audit.createdAt,
      });
    });
  }

  async flush(): Promise<void> {
    await this.pending;
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }
}
