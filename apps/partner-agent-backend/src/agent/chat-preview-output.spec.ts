import { describe, expect, it } from 'vitest';
import { CHAT_PREVIEW_ERROR_CODES } from '@partner-agent/contracts';
import {
  ChatPreviewOutputCollector,
  StructuredPreviewOutputError,
} from './chat-preview-output.js';

const proposal = {
  schema_version: 1 as const,
  kind: 'action' as const,
  source_refs: [{ kind: 'original_record' as const, id: 'record-a' }],
  content: {
    title: '周五前提交报销',
    description: '整理票据并提交审批。',
    planned_at: '2026-09-07T09:00:00+08:00',
    deadline_at: '2026-09-11T18:00:00+08:00',
    timezone: 'Asia/Shanghai',
    priority: 'high' as const,
    confidence: 0.92,
  },
};

function collector(taskId = 'task-a') {
  return new ChatPreviewOutputCollector({
    taskId,
    allowedSourceRefs: [
      { kind: 'original_record', id: 'record-a' },
      { kind: 'chat_message', id: 'message-a' },
    ],
  });
}

describe('ChatPreviewOutputCollector', () => {
  it('adds server-owned identity, fixed unconfirmed state and the current message source', () => {
    const output = collector();
    const preview = output.collect(proposal);

    expect(preview).toMatchObject({
      schema_version: 1,
      kind: 'action',
      confirmation_status: 'unconfirmed',
      applied: false,
      source_refs: [
        { kind: 'original_record', id: 'record-a' },
        { kind: 'chat_message', id: 'message-a' },
      ],
      content: proposal.content,
      warnings: [],
    });
    expect(preview.preview_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(output.complete()).toEqual([preview]);
  });

  it('uses current-input sources when the model omits source suggestions', () => {
    const output = collector();
    const preview = output.collect({
      ...proposal,
      source_refs: undefined,
    });

    expect(preview.source_refs).toEqual([
      { kind: 'original_record', id: 'record-a' },
      { kind: 'chat_message', id: 'message-a' },
    ]);
  });

  it('rejects schema, time and size violations without retaining raw output', () => {
    const cases = [
      { ...proposal, content: { ...proposal.content, confidence: 2 } },
      {
        ...proposal,
        content: {
          ...proposal.content,
          planned_at: '2026-09-12T09:00:00+08:00',
          deadline_at: '2026-09-11T18:00:00+08:00',
        },
      },
      {
        ...proposal,
        content: { ...proposal.content, description: 'x'.repeat(70_000) },
      },
    ];

    for (const value of cases) {
      const output = collector();
      expect(() => output.collect(value)).toThrow(StructuredPreviewOutputError);
      expect(output.snapshot()).toEqual([]);
    }
  });

  it('rejects source references outside the current task input', () => {
    const output = collector();
    expect(() =>
      output.collect({
        ...proposal,
        source_refs: [{ kind: 'original_record', id: 'record-other' }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: CHAT_PREVIEW_ERROR_CODES.SOURCE_INVALID }),
    );
  });

  it('distinguishes missing output from an uncorrected invalid output', () => {
    expect(() => collector().complete()).toThrowError(
      expect.objectContaining({ code: CHAT_PREVIEW_ERROR_CODES.MISSING }),
    );

    const invalid = collector();
    invalid.noteRejectedAttempt();
    expect(() => invalid.complete()).toThrowError(
      expect.objectContaining({ code: CHAT_PREVIEW_ERROR_CODES.INVALID }),
    );
  });

  it('allows one correction and fails after a second rejected attempt', () => {
    const corrected = collector();
    expect(corrected.noteRejectedAttempt()).toBe('retry');
    corrected.collect(proposal);
    expect(corrected.complete()).toHaveLength(1);

    const exhausted = collector();
    expect(exhausted.noteRejectedAttempt()).toBe('retry');
    expect(exhausted.noteRejectedAttempt()).toBe('exhausted');
    expect(() => exhausted.collect(proposal)).toThrowError(
      expect.objectContaining({ code: CHAT_PREVIEW_ERROR_CODES.INVALID }),
    );
  });

  it('generates stable IDs for retry while keeping task collectors isolated', () => {
    const first = collector('same-task').collect(proposal).preview_id;
    const retry = collector('same-task').collect(proposal).preview_id;
    const other = collector('other-task').collect(proposal).preview_id;

    expect(retry).toBe(first);
    expect(other).not.toBe(first);
  });
});
