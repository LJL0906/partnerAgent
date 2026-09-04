import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { MemorySessionStore } from '../database/memory-session.store.js';
import { MemoryEgressDecisionStore } from '../model-gateway/memory-egress-decision.store.js';
import { ChatTaskEventBus } from './chat-task-event.bus.js';
import type { ChatTaskScheduler } from './chat-task-scheduler.js';
import { MemoryChatTaskStore } from './memory-chat-task.store.js';
import { PrivacyDecisionService } from './privacy-decision.service.js';

const ownerId = 'owner';

describe('PrivacyDecisionService', () => {
  it('accepts allow once and resumes through the dedicated scheduler path', async () => {
    const fixture = await createFixture();
    const result = (await fixture.service.submit(
      request('decision-operation', fixture.decision.id, 'allow'),
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ status: 'accepted' });
    expect(fixture.scheduler.resumeAfterPrivacyDecision).toHaveBeenCalledOnce();

    const replay = (await fixture.service.submit(
      request('decision-operation', fixture.decision.id, 'allow'),
    )) as Record<string, unknown>;
    expect(replay).toMatchObject({ status: 'duplicate' });
    expect(fixture.scheduler.resumeAfterPrivacyDecision).toHaveBeenCalledOnce();
  });

  it('blocks synchronously and never resumes the provider task', async () => {
    const fixture = await createFixture();
    const result = (await fixture.service.submit(
      request('block-operation', fixture.decision.id, 'block'),
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ status: 'completed' });
    expect(fixture.scheduler.resumeAfterPrivacyDecision).not.toHaveBeenCalled();
    expect(
      (await fixture.tasks.getTask(ownerId, fixture.task.taskId))?.state,
    ).toBe('failed');
  });

  it('hides cross-owner requests and expires without resuming', async () => {
    const fixture = await createFixture();
    await expect(
      fixture.service.submit({
        userId: 'other',
        input: {},
        envelope: request(
          'other-operation',
          fixture.decision.id,
          'allow',
        ).envelope,
      }),
    ).rejects.toMatchObject({ status: 404 });
    fixture.clock.setTime(fixture.decision.expiresAt.getTime());
    await expect(
      fixture.service.submit(
        request('expired-operation', fixture.decision.id, 'allow'),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fixture.scheduler.resumeAfterPrivacyDecision).not.toHaveBeenCalled();
    expect(
      (await fixture.tasks.getTask(ownerId, fixture.task.taskId))?.state,
    ).toBe('failed');
  });

  it('recovers a persisted ready decision on startup', async () => {
    const fixture = await createFixture();
    await fixture.decisions.submitDecision({
      ownerId,
      egressId: fixture.decision.id,
      decision: 'redact',
      commandOperationId: 'persisted-operation',
      commandRequestFingerprint: 'persisted-fingerprint',
    });
    await fixture.service.onModuleInit();
    expect(fixture.scheduler.resumeAfterPrivacyDecision).toHaveBeenCalledOnce();
    fixture.service.onModuleDestroy();
  });

  it('fails an expired waiting task during the startup sweep', async () => {
    const fixture = await createFixture();
    fixture.clock.setTime(fixture.decision.expiresAt.getTime());
    await fixture.service.onModuleInit();
    expect(
      (await fixture.tasks.getTask(ownerId, fixture.task.taskId))?.state,
    ).toBe('failed');
    expect(fixture.scheduler.resumeAfterPrivacyDecision).not.toHaveBeenCalled();
    fixture.service.onModuleDestroy();
  });
});

async function createFixture() {
  const clock = new Date('2026-09-04T10:00:00.000Z');
  const sessions = new MemorySessionStore();
  const tasks = new MemoryChatTaskStore(sessions);
  const accepted = await tasks.submitText({
    ownerId,
    operationId: 'chat-operation',
    requestFingerprint: 'chat-fingerprint',
    clientSource: 'web',
    text: 'secret=hidden',
    inputId: 'input',
  });
  await tasks.markRunning(accepted.task!.taskId, ownerId);
  await tasks.markWaiting(accepted.task!.taskId, ownerId);
  const decisions = new MemoryEgressDecisionStore(
    () => new Date(clock.getTime()),
  );
  const decision = await decisions.createOrGetPending({
    ownerId,
    taskId: accepted.task!.taskId,
    sessionId: accepted.task!.sessionId,
    operationId: accepted.task!.operationId,
    requestFingerprint: 'payload-fingerprint',
    provider: 'deepseek',
    modelId: 'model',
    source: 'submit_text_input',
    categories: ['secret'],
    ttlMs: 900_000,
  });
  const scheduler = {
    schedule: vi.fn(),
    resumeAfterPrivacyDecision: vi.fn(),
    cancel: vi.fn(),
  } as unknown as ChatTaskScheduler;
  const service = new PrivacyDecisionService(
    decisions,
    tasks,
    scheduler,
    new ChatTaskEventBus(),
    new ConfigService(),
  );
  return {
    service,
    scheduler,
    tasks,
    decisions,
    task: accepted.task!,
    decision,
    clock,
  };
}

function request(
  operationId: string,
  egressId: string,
  decision: 'allow' | 'redact' | 'block',
) {
  return {
    userId: ownerId,
    input: {},
    envelope: {
      operation_id: operationId,
      client_source: 'web',
      request_fingerprint: `fingerprint-${operationId}`,
      payload: { egress_id: egressId, decision },
    },
  };
}
