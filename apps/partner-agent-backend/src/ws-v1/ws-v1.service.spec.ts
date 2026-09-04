import type { ServerPushEventV1 } from '@partner-agent/contracts';
import type { Socket } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';
import { ChatTaskEventBus } from '../local-core-api/chat-task-event.bus.js';
import { RedactionService } from '../tools/redaction.service.js';
import type { WsV1ChannelAuthorizer } from './ws-v1-channel-authorizer.js';
import {
  WsV1EventStore,
  type WsV1PublishInput,
  type WsV1ReplayResult,
  type WsV1StoredEvent,
  type WsV1StoredEventListener,
} from './ws-v1-event.store.js';
import { WsV1Service } from './ws-v1.service.js';

class ControlledEventStore extends WsV1EventStore {
  listener?: WsV1StoredEventListener;
  replay = Promise.resolve<WsV1ReplayResult>({
    replayable: true,
    events: [],
    latestPosition: 0,
  });
  readonly replayAfterCall = vi.fn();

  async start(listener: WsV1StoredEventListener): Promise<void> {
    this.listener = listener;
  }

  async stop(): Promise<void> {}

  async append(
    _input: WsV1PublishInput,
    _streamKey?: string,
  ): Promise<WsV1StoredEvent> {
    throw new Error('not used');
  }

  async replayAfter(): Promise<WsV1ReplayResult> {
    this.replayAfterCall();
    return this.replay;
  }

  async createRecoveryRequired(): Promise<ServerPushEventV1> {
    throw new Error('not used');
  }

  async dispatchStored(record: WsV1StoredEvent): Promise<void> {
    await this.listener?.(record);
  }

  acknowledgeDelivery(): void {}
}

function event(id: string, sequence: number): WsV1StoredEvent {
  return {
    streamKey: 'session:s1',
    event: {
      schema_version: 1,
      event_id: id,
      channel: 'session:s1',
      sequence,
      event_type: 'text_delta',
      timestamp: sequence,
      data: String(sequence),
    },
  };
}

describe('WsV1Service subscription handoff', () => {
  it('deduplicates live events during replay and flushes only the later tail', async () => {
    let resolveReplay!: (value: WsV1ReplayResult) => void;
    const store = new ControlledEventStore();
    store.replay = new Promise((resolve) => {
      resolveReplay = resolve;
    });
    const service = new WsV1Service(
      { canSubscribe: vi.fn(async () => true) } as unknown as WsV1ChannelAuthorizer,
      store,
      new RedactionService(),
      new ChatTaskEventBus(),
    );
    await service.onModuleInit();
    const socket = {
      id: 'socket-1',
      data: { userId: 'owner' },
      emit: vi.fn(),
    } as unknown as Socket;
    service.connect(socket);

    const subscribing = service.subscribe(socket, {
      request_id: 'request-1',
      channels: ['session:s1'],
      after: { 'session:s1': 'cursor' },
    });
    await vi.waitFor(() => expect(store.replayAfterCall).toHaveBeenCalled());
    const duringReplay = event('00000000-0000-4000-8000-000000000001', 2);
    await store.listener?.(duringReplay);
    resolveReplay({
      replayable: true,
      events: [duringReplay.event],
      latestPosition: 2,
    });

    const result = await subscribing;
    expect(result.replay).toEqual([duringReplay.event]);
    const afterReplay = event('00000000-0000-4000-8000-000000000002', 3);
    await store.listener?.(afterReplay);
    service.activateSubscriptions(socket, result.ack.accepted);

    expect(socket.emit).toHaveBeenCalledOnce();
    expect(socket.emit).toHaveBeenCalledWith('agent_event', afterReplay.event);
    await service.onModuleDestroy();
  });
});
