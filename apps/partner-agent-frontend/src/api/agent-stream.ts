import type { AgentEvent } from '@partner-agent/contracts';
import { WS_EVENTS } from '@partner-agent/contracts';
import { io, type Socket } from 'socket.io-client';

import { apiConfig } from './config';

export type AgentStreamEvent = AgentEvent & {
  operation_id?: string;
  task_id?: string;
};

interface ServerToClientEvents {
  agent_event: (event: AgentStreamEvent) => void;
}

type ClientToServerEvents = Record<string, never>;

export type StreamConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface StreamSubscription {
  sessionId: string;
  operationId?: string;
  accessToken?: string;
  onEvent: (event: AgentStreamEvent) => void;
  onStatusChange?: (status: StreamConnectionStatus) => void;
}

export function subscribeAgentStream(subscription: StreamSubscription): () => void {
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(apiConfig.serverUrl, {
    autoConnect: false,
    auth: subscription.accessToken ? { token: subscription.accessToken } : undefined,
  });

  const handleEvent = (event: AgentStreamEvent) => {
    if (event.sessionId !== subscription.sessionId) return;
    if (
      subscription.operationId &&
      event.operation_id &&
      event.operation_id !== subscription.operationId
    ) {
      return;
    }
    subscription.onEvent(event);
  };

  subscription.onStatusChange?.('connecting');
  socket.on('connect', () => subscription.onStatusChange?.('connected'));
  socket.on('disconnect', () => subscription.onStatusChange?.('disconnected'));
  socket.on('connect_error', () => subscription.onStatusChange?.('error'));
  socket.on(WS_EVENTS.AGENT_EVENT, handleEvent);
  socket.connect();

  return () => {
    socket.off(WS_EVENTS.AGENT_EVENT, handleEvent);
    socket.disconnect();
  };
}
