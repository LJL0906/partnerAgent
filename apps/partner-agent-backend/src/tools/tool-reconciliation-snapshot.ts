import {
  ToolReconciliationError,
  type PendingToolReconciliation,
  type ToolConfirmationRecord,
  type ToolReconciliationSnapshot,
} from './tool-operation.store.js';

export function createToolReconciliationSnapshot(
  record: ToolConfirmationRecord,
  capturedAt: Date,
): ToolReconciliationSnapshot {
  if (!record.taskId || !record.operationId || !record.requestSummary.trim()) {
    throw new ToolReconciliationError('核对安全快照缺失');
  }
  return {
    confirmationId: record.id,
    ownerId: record.ownerId,
    sessionId: record.sessionId,
    taskId: record.taskId,
    operationId: record.operationId,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    requestSummary: record.requestSummary,
    ...(record.resultSummary ? { resultSummary: record.resultSummary } : {}),
    capturedAt,
  };
}

export function toolReconciliationSnapshotFrom(
  value: unknown,
): ToolReconciliationSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const snapshot = value as Record<string, unknown>;
  const capturedAt = new Date(String(snapshot.capturedAt ?? ''));
  const required = [
    'confirmationId',
    'ownerId',
    'sessionId',
    'taskId',
    'operationId',
    'toolCallId',
    'toolName',
    'requestSummary',
  ];
  if (
    required.some(
      (key) => typeof snapshot[key] !== 'string' || !snapshot[key],
    ) ||
    Number.isNaN(capturedAt.getTime())
  ) {
    return undefined;
  }
  return {
    confirmationId: String(snapshot.confirmationId),
    ownerId: String(snapshot.ownerId),
    sessionId: String(snapshot.sessionId),
    taskId: String(snapshot.taskId),
    operationId: String(snapshot.operationId),
    toolCallId: String(snapshot.toolCallId),
    toolName: String(snapshot.toolName),
    requestSummary: String(snapshot.requestSummary),
    ...(typeof snapshot.resultSummary === 'string'
      ? { resultSummary: snapshot.resultSummary }
      : {}),
    capturedAt,
  };
}

export function requireToolReconciliationSnapshot(
  record: ToolConfirmationRecord,
): ToolReconciliationSnapshot {
  const snapshot = record.reconciliationSnapshot;
  if (
    !snapshot ||
    snapshot.confirmationId !== record.id ||
    snapshot.ownerId !== record.ownerId ||
    snapshot.taskId !== record.taskId ||
    snapshot.operationId !== record.operationId ||
    !snapshot.requestSummary.trim()
  ) {
    throw new ToolReconciliationError('核对安全快照缺失或不匹配');
  }
  return structuredClone(snapshot);
}

export function pendingToolReconciliationFrom(
  record: ToolConfirmationRecord,
): PendingToolReconciliation {
  return {
    confirmationId: record.id,
    ownerId: record.ownerId,
    currentVersion: record.version ?? 1,
    currentStatus: 'indeterminate',
    snapshot: requireToolReconciliationSnapshot(record),
  };
}
