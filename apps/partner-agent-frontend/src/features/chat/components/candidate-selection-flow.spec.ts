import type { ChatItem } from '@partner-agent/contracts';
import { describe, expect, it, vi } from 'vitest';

import {
  applyCandidateChoice,
  buildCandidateQuestionPages,
  formatCandidateAnswers,
  resolveCandidateSelectionInitialOpen,
  submitCandidateAnswers,
} from './candidate-selection-flow';

vi.mock('react-native', () => ({
  Modal: vi.fn(), Pressable: vi.fn(), ScrollView: vi.fn(), Text: vi.fn(), View: vi.fn(),
}));
vi.mock('@/components/ui/app-button', () => ({ AppButton: vi.fn() }));
vi.mock('@/components/ui/app-icon', () => ({ AppIcon: vi.fn() }));

function candidate(id: string, batchId: string, taskId: string, title: string): ChatItem {
  return {
    schema_version: 1, id: `candidate:${id}`, type: 'candidate', status: 'pending',
    collapsed: true, created_at: 3, updated_at: 3, revision: 1, task_id: taskId,
    candidate_id: id, payload: { candidate_id: id, kind: 'action', applied: false,
      batch_ref: { kind: 'confirmation_batch', id: batchId },
      preview: { title, description: `${title}说明。默认时区 Asia/Shanghai。`,
        planned_at: '2026-09-11T09:00:00+08:00', timezone: 'Asia/Shanghai' } },
  };
}

describe('candidate selection flow model', () => {
  it('keeps restored candidate choices collapsed until the user opens them', () => {
    expect(resolveCandidateSelectionInitialOpen()).toBe(false);
    expect(resolveCandidateSelectionInitialOpen(true)).toBe(true);
  });

  it('turns candidates from the same batch into radio choices on one question page', () => {
    const assistant: ChatItem = {
      schema_version: 1, id: 'task:task-1:assistant', type: 'message', status: 'completed',
      collapsed: false, created_at: 2, updated_at: 2, revision: 1, task_id: 'task-1',
      payload: { role: 'assistant', content: '你想周五还是周六提醒？' },
    };
    const pages = buildCandidateQuestionPages([
      assistant,
      candidate('friday', 'batch-1', 'task-1', '周五下午五点'),
      candidate('saturday', 'batch-1', 'task-1', '周六上午九点'),
    ]);

    expect(pages).toEqual([expect.objectContaining({
      id: 'batch-1', anchorItemId: 'candidate:friday', question: '你想周五还是周六提醒？',
      choices: [
        expect.objectContaining({ id: 'friday', label: '周五下午五点' }),
        expect.objectContaining({ id: 'saturday', label: '周六上午九点' }),
      ],
    })]);
    expect(pages[0]?.choices[0]?.description).toContain('周五下午五点说明。');
    expect(pages[0]?.choices[0]?.description).toContain('9月11日 周五 09:00');
    expect(pages[0]?.choices[0]?.description).not.toContain('默认时区');
  });

  it('collects selections from every page into one message for the model', () => {
    const pages = buildCandidateQuestionPages([
      candidate('friday', 'batch-1', 'task-1', '周五下午五点'),
      candidate('email', 'batch-2', 'task-2', '邮件提醒'),
    ]);
    const message = formatCandidateAnswers(pages, {
      'batch-1': 'friday',
      'batch-2': 'email',
    });

    expect(message).toContain('问题 1');
    expect(message).toContain('周五下午五点');
    expect(message).toContain('问题 2');
    expect(message).toContain('邮件提醒');
    expect(message).toContain('这些选择即为最终授权');
    expect(message).toContain('无需再次询问或确认');
    expect(message).toContain('请立即按正式流程执行');
  });

  it('submits immediately when the final page receives its answer', () => {
    const pages = buildCandidateQuestionPages([
      candidate('friday', 'batch-1', 'task-1', '周五下午五点'),
      candidate('email', 'batch-2', 'task-2', '邮件提醒'),
    ]);

    const first = applyCandidateChoice(pages, {}, 0, 'friday');
    expect(first).toEqual({
      selections: { 'batch-1': 'friday' },
      nextPageIndex: 1,
      shouldSubmit: false,
    });

    const final = applyCandidateChoice(pages, first.selections, 1, 'email');
    expect(final).toEqual({
      selections: { 'batch-1': 'friday', 'batch-2': 'email' },
      nextPageIndex: 1,
      shouldSubmit: true,
    });
  });

  it('hides the selection flow before waiting for the model submission', async () => {
    const pages = buildCandidateQuestionPages([
      candidate('friday', 'batch-1', 'task-1', '周五下午五点'),
    ]);
    const events: string[] = [];
    let resolveSubmission: ((accepted: boolean) => void) | undefined;
    const pendingSubmission = new Promise<boolean>((resolve) => { resolveSubmission = resolve; });

    const result = submitCandidateAnswers(
      pages,
      { 'batch-1': 'friday' },
      () => {
        events.push('send');
        return pendingSubmission;
      },
      {
        onStart: () => events.push('hide'),
        onRejected: () => events.push('restore'),
      },
    );

    expect(events).toEqual(['hide', 'send']);
    resolveSubmission?.(false);
    await expect(result).resolves.toBe(false);
    expect(events).toEqual(['hide', 'send', 'restore']);
  });

  it('extracts the final direct question instead of showing the full assistant reply', () => {
    const assistant: ChatItem = {
      schema_version: 1, id: 'task:task-1:assistant', type: 'message', status: 'completed',
      collapsed: false, created_at: 2, updated_at: 2, revision: 1, task_id: 'task-1',
      payload: { role: 'assistant', content: '我准备了两个候选。方案 A 是周五，方案 B 是周六。请问你选择哪一个？告诉我即可。' },
    };

    const pages = buildCandidateQuestionPages([
      assistant,
      candidate('friday', 'batch-1', 'task-1', '周五'),
      candidate('saturday', 'batch-1', 'task-1', '周六'),
    ]);

    expect(pages[0]?.question).toBe('请问你选择哪一个？');
  });

  it('uses the nearest preceding assistant question when restored messages have no shared task id', () => {
    const assistant: ChatItem = {
      schema_version: 1, id: 'assistant-without-task', type: 'message', status: 'completed',
      collapsed: false, created_at: 2, updated_at: 2, revision: 1,
      payload: { role: 'assistant', content: '候选已经准备好了。请问你选择方案 A 还是方案 B？' },
    };

    const pages = buildCandidateQuestionPages([
      assistant,
      candidate('friday', 'batch-1', 'task-1', '周五'),
      candidate('saturday', 'batch-1', 'task-1', '周六'),
    ]);

    expect(pages[0]?.question).toBe('请问你选择方案 A 还是方案 B？');
  });

  it('removes internal pending-selection wording from choice descriptions', () => {
    const item = candidate('friday', 'batch-1', 'task-1', '周五');
    if (item.type === 'candidate') {
      item.payload.preview.description = '在周五下午五点提醒审批周报（待用户从两个方案中选择）。';
    }

    const pages = buildCandidateQuestionPages([item]);

    expect(pages[0]?.choices[0]?.description).toContain('在周五下午五点提醒审批周报。');
    expect(pages[0]?.choices[0]?.description).not.toContain('待用户');
  });

  it('merges multiple structured previews from one reply while leaving one preview inline', () => {
    const preview = (id: string, title: string): ChatItem => ({
      schema_version: 1, id: `preview:${id}`, type: 'structured_preview', status: 'completed',
      collapsed: true, created_at: 3, updated_at: 3, revision: 1, task_id: 'task-preview',
      preview_id: id, payload: { schema_version: 1, preview_id: id, kind: 'action',
        confirmation_status: 'unconfirmed', applied: false, source_refs: [], warnings: [],
        content: { title, confidence: 0.7 } },
    });

    expect(buildCandidateQuestionPages([preview('only', '唯一预览')])).toEqual([]);
    expect(buildCandidateQuestionPages([
      preview('morning', '上午提醒'), preview('evening', '晚上提醒'),
    ])).toEqual([expect.objectContaining({
      id: 'task-preview', itemIds: ['preview:morning', 'preview:evening'],
      choices: [
        expect.objectContaining({ id: 'morning', label: '上午提醒' }),
        expect.objectContaining({ id: 'evening', label: '晚上提醒' }),
      ],
    })]);
  });
});
