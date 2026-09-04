import type { BusinessObjectAction } from '@partner-agent/contracts';
import { confirmationError } from './confirmation-transaction.errors.js';
import { ConfirmationTransactionPersistence } from './confirmation-transaction.persistence.js';
import type {
  BusinessRow,
  CandidateRow,
  ChangedObject,
  JsonObject,
  ParsedPayload,
} from './confirmation-transaction.types.js';
import { itemFor } from './confirmation.validator.js';

export class ConfirmationDomainService {
  constructor(
    private readonly persistence: ConfirmationTransactionPersistence,
  ) {}

  async applyCandidates(
    userId: string,
    batchId: string,
    actionId: string,
    payload: ParsedPayload,
    candidates: CandidateRow[],
    objects: BusinessRow[],
    now: Date | string,
  ): Promise<ChangedObject[]> {
    const objectMap = new Map(objects.map((object) => [object.id, object]));
    const changed: ChangedObject[] = [];
    for (const candidate of candidates) {
      const item = itemFor(payload, candidate.id);
      const effectivePayload =
        item.decision === 'modify_confirm'
          ? item.modified_payload
          : candidate.payload;
      if (!effectivePayload) {
        throw confirmationError(
          'VALIDATION_002',
          '编辑确认缺少 edited_payload',
          422,
        );
      }
      const before = candidate.target_object_id
        ? await this.persistence.snapshot(
            this.requireTarget(objectMap, candidate.target_object_id),
          )
        : null;
      const mergedPayload = before?.domain
        ? { ...before.domain, ...effectivePayload }
        : effectivePayload;
      const object = await this.applyOne(
        userId,
        batchId,
        candidate,
        mergedPayload,
        objectMap,
        now,
      );
      const after = await this.persistence.snapshot(object);
      await this.persistence.recordChange(
        userId,
        actionId,
        candidate,
        object,
        {
          before: candidate.action === 'permanent_delete' ? null : before,
          after,
        },
        now,
      );
      changed.push({
        id: object.id,
        kind: object.kind,
        version: object.version,
      });
    }
    return changed;
  }

  private async applyOne(
    userId: string,
    batchId: string,
    candidate: CandidateRow,
    payload: JsonObject,
    objectMap: Map<string, BusinessRow>,
    now: Date | string,
  ): Promise<BusinessRow> {
    if (candidate.action === 'create') {
      return this.persistence.createObject(
        userId,
        batchId,
        candidate,
        payload,
        now,
      );
    }
    const target = this.requireTarget(objectMap, candidate.target_object_id!);
    if (
      target.kind !== candidate.kind ||
      target.lifecycle_status === 'purged'
    ) {
      throw confirmationError(
        'CONFIRMATION_003',
        '目标对象类型或生命周期冲突',
        409,
      );
    }
    return this.persistence.updateObject(
      userId,
      batchId,
      candidate,
      target,
      payload,
      this.nextLifecycle(candidate.action, target.lifecycle_status),
      now,
    );
  }

  async applyUndo(
    userId: string,
    batchId: string,
    actionId: string,
    originalActionId: string,
    candidates: CandidateRow[],
    objects: BusinessRow[],
    now: Date | string,
  ): Promise<ChangedObject[]> {
    const versions = await this.persistence.loadUndoVersions(
      userId,
      originalActionId,
    );
    const selected = candidates
      .map((candidate) => candidate.target_object_id)
      .sort();
    const original = versions.map((version) => version.object_id).sort();
    if (JSON.stringify(selected) !== JSON.stringify(original)) {
      throw confirmationError(
        'CONFIRMATION_003',
        '撤销必须覆盖原操作的全部对象',
        409,
      );
    }
    if (
      versions.some((version) => version.change_type === 'permanent_delete')
    ) {
      throw confirmationError('CONFIRMATION_003', '彻底删除不可撤销', 409);
    }

    const objectMap = new Map(objects.map((object) => [object.id, object]));
    const changed: ChangedObject[] = [];
    for (const version of versions) {
      const current = this.requireTarget(objectMap, version.object_id);
      if (String(current.version) !== String(version.object_version)) {
        throw confirmationError(
          'VERSION_001',
          '对象已有后续版本，不能撤销',
          409,
          {
            object_id: current.id,
            expected_version: version.object_version,
            current_version: current.version,
          },
        );
      }
      const beforeUndo = await this.persistence.snapshot(current);
      const updated = await this.persistence.restoreObject(
        userId,
        batchId,
        current,
        version.snapshot.before,
        now,
      );
      const after = await this.persistence.snapshot(updated);
      const candidate = candidates.find(
        (item) => item.target_object_id === current.id,
      )!;
      await this.persistence.recordChange(
        userId,
        actionId,
        candidate,
        updated,
        { before: beforeUndo, after },
        now,
      );
      changed.push({
        id: updated.id,
        kind: updated.kind,
        version: updated.version,
      });
    }
    return changed;
  }

  private requireTarget(
    objects: Map<string, BusinessRow>,
    objectId: string,
  ): BusinessRow {
    const target = objects.get(objectId);
    if (!target) throw confirmationError('DEPS_002', '目标正式对象不存在', 409);
    return target;
  }

  private nextLifecycle(action: BusinessObjectAction, current: string): string {
    if (action === 'archive') return 'archived';
    if (action === 'soft_delete') return 'soft_deleted';
    if (action === 'permanent_delete') return 'purged';
    if (action === 'restore') {
      if (!['archived', 'soft_deleted'].includes(current)) {
        throw confirmationError(
          'CONFIRMATION_003',
          '当前生命周期不能恢复',
          409,
        );
      }
      return 'active';
    }
    return current;
  }
}
