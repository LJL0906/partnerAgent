import type {
  ServerPushEventV1,
  SubscribeRequestV1,
  SubscriptionAckV1,
  SubscriptionChannel,
  UnsubscribeRequestV1,
} from '@partner-agent/contracts';
import { WS_CONTROL_EVENTS, WS_SERVER_EVENTS } from '@partner-agent/contracts';
import * as Crypto from 'expo-crypto';
import { io, type Socket } from 'socket.io-client';

import { requireAccessToken } from './access-token';
import { apiConfig } from './config';

const MAX_SEEN_EVENT_IDS = 500;
const activeStreamClosers = new Set<() => void>();

interface ServerToClientEvents {
  agent_event: (event: ServerPushEventV1) => void;
  subscription_ack: (ack: SubscriptionAckV1) => void;
}

interface ClientToServerEvents {
  subscribe: (request: SubscribeRequestV1) => void;
  unsubscribe: (request: UnsubscribeRequestV1) => void;
}

interface ChannelWatermark {
  eventId: string;
  sequence: number;
}

interface PendingRequest {
  kind: 'subscribe' | 'unsubscribe';
  channels: SubscriptionChannel[];
  resolve: (ack: SubscriptionAckV1) => void;
  reject: (error: Error) => void;
}

interface DeferredSubscription {
  channels: SubscriptionChannel[];
  resolve: (ack: SubscriptionAckV1) => void;
  reject: (error: Error) => void;
}

export type StreamConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'auth_required';

export interface StreamSubscription {
  channels: SubscriptionChannel[];
  onEvent: (event: ServerPushEventV1) => void;
  onSubscriptionAck?: (ack: SubscriptionAckV1) => void;
  onSubscriptionError?: (error: SubscriptionRejectedError) => void;
  onConnectionError?: (error: AgentStreamConnectError) => void;
  onStatusChange?: (status: StreamConnectionStatus) => void;
}

export interface StreamChannelUpdate {
  subscribed?: SubscriptionAckV1;
  unsubscribed?: SubscriptionAckV1;
}

/** Callable for compatibility with the previous cleanup return value. */
export interface AgentStreamConnection {
  (): void;
  close: () => void;
  getChannels: () => SubscriptionChannel[];
  setChannels: (channels: SubscriptionChannel[]) => Promise<StreamChannelUpdate>;
  subscribe: (channels: SubscriptionChannel[]) => Promise<SubscriptionAckV1>;
  unsubscribe: (channels: SubscriptionChannel[]) => Promise<SubscriptionAckV1 | undefined>;
}

export class SubscriptionRejectedError extends Error {
  constructor(public readonly ack: SubscriptionAckV1) {
    super(
      `实时订阅失败：${ack.rejected
        .map((rejection) => `${rejection.channel}: ${rejection.message}`)
        .join('；')}`,
    );
    this.name = 'SubscriptionRejectedError';
  }
}

export class StreamDisconnectedError extends Error {
  constructor() {
    super('实时连接在订阅确认前断开。');
    this.name = 'StreamDisconnectedError';
  }
}

export type AgentStreamConnectErrorKind = 'auth' | 'network' | 'configuration';

/** 对 UI 安全的连接错误；绝不透传 Socket.IO 或服务端原始消息。 */
export class AgentStreamConnectError extends Error {
  constructor(public readonly kind: AgentStreamConnectErrorKind) {
    super(
      kind === 'auth'
        ? '实时连接鉴权失败，请重新登录。'
        : kind === 'configuration'
          ? '实时服务配置无效，请联系管理员。'
          : '无法连接实时服务，请检查网络后重试。',
    );
    this.name = 'AgentStreamConnectError';
  }
}

/** 退出登录时同步关闭全部连接，并丢弃各连接闭包内的游标与去重状态。 */
export function closeAllAgentStreams(): void {
  for (const close of [...activeStreamClosers]) close();
}

export async function subscribeAgentStream(
  subscription: StreamSubscription,
): Promise<AgentStreamConnection> {
  subscription.onStatusChange?.('connecting');

  const serverUrl = getConfiguredServerUrl();
  if (!serverUrl) {
    const error = new AgentStreamConnectError('configuration');
    subscription.onStatusChange?.('error');
    safelyReportConnectionError(subscription, error);
    throw error;
  }

  let accessToken: string;
  try {
    accessToken = await requireAccessToken();
  } catch (error) {
    subscription.onStatusChange?.('auth_required');
    throw error;
  }

  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    `${serverUrl}${apiConfig.streamNamespace}`,
    { autoConnect: false, auth: { token: accessToken } },
  );
  const desiredChannels = new Set(subscription.channels);
  const acknowledgedChannels = new Set<SubscriptionChannel>();
  const channelWatermarks = new Map<SubscriptionChannel, ChannelWatermark>();
  const seenEventIds = new Set<string>();
  const seenEventOrder: string[] = [];
  const pendingRequests = new Map<string, PendingRequest>();
  const deferredSubscriptions: DeferredSubscription[] = [];
  let closed = false;
  let hasBeenReady = false;
  let lastConnectionErrorKind: AgentStreamConnectErrorKind | undefined;

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const reportRejected = (ack: SubscriptionAckV1): SubscriptionRejectedError => {
    const error = new SubscriptionRejectedError(ack);
    try {
      subscription.onSubscriptionError?.(error);
    } catch {
      subscription.onStatusChange?.('error');
    }
    return error;
  };

  const settleDeferredSubscriptions = (ack: SubscriptionAckV1) => {
    for (let index = deferredSubscriptions.length - 1; index >= 0; index -= 1) {
      const deferred = deferredSubscriptions[index];
      const relevantRejected = ack.rejected.filter((item) =>
        deferred.channels.includes(item.channel as SubscriptionChannel),
      );
      const accepted = deferred.channels.filter((channel) => ack.accepted.includes(channel));
      if (accepted.length + relevantRejected.length !== deferred.channels.length) continue;
      deferredSubscriptions.splice(index, 1);
      const deferredAck: SubscriptionAckV1 = {
        request_id: ack.request_id,
        accepted,
        rejected: relevantRejected,
      };
      if (relevantRejected.length > 0) {
        deferred.reject(new SubscriptionRejectedError(deferredAck));
      }
      else deferred.resolve(deferredAck);
    }
  };

  const handleSubscriptionAck = (ack: SubscriptionAckV1) => {
    const pending = pendingRequests.get(ack.request_id);
    if (!pending) return;
    pendingRequests.delete(ack.request_id);

    if (pending.kind === 'subscribe') {
      for (const channel of ack.accepted) acknowledgedChannels.add(channel);
      for (const rejection of ack.rejected) {
        desiredChannels.delete(rejection.channel as SubscriptionChannel);
        acknowledgedChannels.delete(rejection.channel as SubscriptionChannel);
      }
      settleDeferredSubscriptions(ack);
    } else {
      for (const channel of ack.accepted) acknowledgedChannels.delete(channel);
      for (const rejection of ack.rejected) {
        desiredChannels.add(rejection.channel as SubscriptionChannel);
      }
    }

    try {
      subscription.onSubscriptionAck?.(ack);
    } catch {
      subscription.onStatusChange?.('error');
    }
    if (ack.rejected.length > 0) pending.reject(reportRejected(ack));
    else pending.resolve(ack);
  };

  const sendRequest = (
    kind: PendingRequest['kind'],
    channels: SubscriptionChannel[],
  ): Promise<SubscriptionAckV1> => {
    const requestId = Crypto.randomUUID();
    const request = {
      request_id: requestId,
      channels,
      ...(kind === 'subscribe' ? createAfter(channels, channelWatermarks) : {}),
    };
    const promise = new Promise<SubscriptionAckV1>((resolve, reject) => {
      pendingRequests.set(requestId, { kind, channels, resolve, reject });
    });
    socket.emit(kind, request);
    return promise;
  };

  const subscribeChannels = (channels: SubscriptionChannel[]): Promise<SubscriptionAckV1> => {
    const additions = unique(channels).filter((channel) => !desiredChannels.has(channel));
    for (const channel of additions) desiredChannels.add(channel);
    if (additions.length === 0) {
      return Promise.resolve({ request_id: Crypto.randomUUID(), accepted: [], rejected: [] });
    }
    if (socket.connected) return sendRequest('subscribe', additions);
    return new Promise<SubscriptionAckV1>((resolve, reject) => {
      deferredSubscriptions.push({ channels: additions, resolve, reject });
    });
  };

  const unsubscribeChannels = async (
    channels: SubscriptionChannel[],
  ): Promise<SubscriptionAckV1 | undefined> => {
    const removals = unique(channels).filter((channel) => desiredChannels.has(channel));
    for (const channel of removals) desiredChannels.delete(channel);
    for (let index = deferredSubscriptions.length - 1; index >= 0; index -= 1) {
      const deferred = deferredSubscriptions[index];
      if (deferred.channels.some((channel) => removals.includes(channel))) {
        deferredSubscriptions.splice(index, 1);
        deferred.reject(new Error('频道在订阅确认前已取消。'));
      }
    }
    if (removals.length === 0 || !socket.connected) {
      for (const channel of removals) acknowledgedChannels.delete(channel);
      return undefined;
    }
    return sendRequest('unsubscribe', removals);
  };

  const handleEvent = (event: ServerPushEventV1) => {
    if (!acceptEvent(event, channelWatermarks, seenEventIds, seenEventOrder)) return;
    if (!isCanonicalEvent(event, acknowledgedChannels)) return;
    subscription.onEvent(event);
  };

  const handleConnect = () => {
    lastConnectionErrorKind = undefined;
    acknowledgedChannels.clear();
    const channels = [...desiredChannels];
    if (channels.length === 0) {
      subscription.onStatusChange?.('connected');
      if (!hasBeenReady) {
        hasBeenReady = true;
        resolveReady();
      }
      return;
    }
    void sendRequest('subscribe', channels)
      .then(() => {
        subscription.onStatusChange?.('connected');
        if (!hasBeenReady) {
          hasBeenReady = true;
          resolveReady();
        }
      })
      .catch((error: unknown) => {
        subscription.onStatusChange?.('error');
        if (!hasBeenReady) rejectReady(asError(error));
      });
  };

  const handleDisconnect = () => {
    acknowledgedChannels.clear();
    for (const pending of pendingRequests.values()) pending.reject(new StreamDisconnectedError());
    pendingRequests.clear();
    if (!closed) subscription.onStatusChange?.('disconnected');
  };
  const handleConnectError = (cause?: unknown) => {
    const error = new AgentStreamConnectError(classifyConnectError(cause));
    subscription.onStatusChange?.(error.kind === 'auth' ? 'auth_required' : 'error');
    if (lastConnectionErrorKind !== error.kind) {
      lastConnectionErrorKind = error.kind;
      safelyReportConnectionError(subscription, error);
    }

    if (error.kind === 'auth') {
      if (!hasBeenReady) rejectReady(error);
      close();
    }
    // 网络错误保留同一个 Socket.IO 客户端继续重连；提示按连续错误类别去重。
  };

  const close = () => {
    if (closed) return;
    closed = true;
    const error = new StreamDisconnectedError();
    activeStreamClosers.delete(close);
    for (const pending of pendingRequests.values()) pending.reject(error);
    pendingRequests.clear();
    for (const deferred of deferredSubscriptions.splice(0)) deferred.reject(error);
    desiredChannels.clear();
    acknowledgedChannels.clear();
    channelWatermarks.clear();
    seenEventIds.clear();
    seenEventOrder.length = 0;
    socket.removeAllListeners();
    socket.disconnect();
    if (!hasBeenReady) rejectReady(error);
  };

  activeStreamClosers.add(close);

  socket.on('connect', handleConnect);
  socket.on('disconnect', handleDisconnect);
  socket.on('connect_error', handleConnectError);
  socket.on(WS_SERVER_EVENTS.AGENT_EVENT, handleEvent);
  socket.on(WS_CONTROL_EVENTS.SUBSCRIPTION_ACK, handleSubscriptionAck);
  socket.connect();

  try {
    await ready;
  } catch (error) {
    close();
    throw error;
  }

  const connection = (() => close()) as AgentStreamConnection;
  connection.close = close;
  connection.getChannels = () => [...desiredChannels];
  connection.subscribe = subscribeChannels;
  connection.unsubscribe = unsubscribeChannels;
  connection.setChannels = async (channels) => {
    const next = new Set(channels);
    const additions = [...next].filter((channel) => !desiredChannels.has(channel));
    const removals = [...desiredChannels].filter((channel) => !next.has(channel));
    const [subscribed, unsubscribed] = await Promise.all([
      additions.length > 0 ? subscribeChannels(additions) : Promise.resolve(undefined),
      removals.length > 0 ? unsubscribeChannels(removals) : Promise.resolve(undefined),
    ]);
    return { subscribed, unsubscribed };
  };
  return connection;
}

function createAfter(
  channels: SubscriptionChannel[],
  channelWatermarks: Map<SubscriptionChannel, ChannelWatermark>,
): Pick<SubscribeRequestV1, 'after'> | Record<string, never> {
  const after: SubscribeRequestV1['after'] = {};
  for (const channel of channels) {
    const watermark = channelWatermarks.get(channel);
    if (watermark) after[channel] = watermark.eventId;
  }
  return Object.keys(after).length > 0 ? { after } : {};
}

function acceptEvent(
  event: ServerPushEventV1,
  channelWatermarks: Map<SubscriptionChannel, ChannelWatermark>,
  seenEventIds: Set<string>,
  seenEventOrder: string[],
): boolean {
  if (seenEventIds.has(event.event_id)) return false;
  rememberEventId(event.event_id, seenEventIds, seenEventOrder);

  // REST reconciliation repairs the snapshot. Keep the expired cursor so a
  // reconnect never silently degrades into a first subscription without after.
  if (event.event_type === 'recovery_required') return true;

  const watermark = channelWatermarks.get(event.channel);
  if (watermark && event.sequence <= watermark.sequence) return false;
  channelWatermarks.set(event.channel, {
    eventId: event.event_id,
    sequence: event.sequence,
  });
  return true;
}

function isCanonicalEvent(
  event: ServerPushEventV1,
  acknowledgedChannels: ReadonlySet<SubscriptionChannel>,
): boolean {
  if (event.event_type === 'recovery_required') return true;
  const preferred = [
    event.task_id ? (`task:${event.task_id}` as const) : undefined,
    event.operation_id ? (`operation:${event.operation_id}` as const) : undefined,
    event.session_id ? (`session:${event.session_id}` as const) : undefined,
    'user:self' as const,
  ].find((channel) => channel && acknowledgedChannels.has(channel));
  return preferred ? event.channel === preferred : false;
}

function rememberEventId(
  eventId: string,
  seenEventIds: Set<string>,
  seenEventOrder: string[],
): void {
  seenEventIds.add(eventId);
  seenEventOrder.push(eventId);
  if (seenEventOrder.length > MAX_SEEN_EVENT_IDS) {
    const expiredEventId = seenEventOrder.shift();
    if (expiredEventId) seenEventIds.delete(expiredEventId);
  }
}

function unique(channels: SubscriptionChannel[]): SubscriptionChannel[] {
  return [...new Set(channels)];
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isValidServerUrl(serverUrl: string): boolean {
  try {
    const parsed = new URL(serverUrl);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.host);
  } catch {
    return false;
  }
}

function getConfiguredServerUrl(): string | undefined {
  if (apiConfig.serverUrlConfigError) return undefined;
  try {
    const serverUrl = apiConfig.serverUrl;
    return isValidServerUrl(serverUrl) ? serverUrl : undefined;
  } catch {
    return undefined;
  }
}

function classifyConnectError(error: unknown): Exclude<AgentStreamConnectErrorKind, 'configuration'> {
  const record = isRecord(error) ? error : undefined;
  const data = isRecord(record?.data) ? record.data : undefined;
  const context = isRecord(record?.context) ? record.context : undefined;
  const statusCandidates = [record?.status, record?.statusCode, data?.status, data?.statusCode, context?.status];
  if (
    statusCandidates.some(
      (status) => status === 401 || status === 403 || status === '401' || status === '403',
    )
  ) {
    return 'auth';
  }

  const codeCandidates = [record?.code, data?.code]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const message = typeof record?.message === 'string' ? record.message : '';
  const searchable = `${codeCandidates} ${message}`.toLowerCase();
  return /\b(401|403)\b|unauthori[sz]ed|authorization|forbidden|authentication|auth_required|bearer|jwt|token|鉴权|认证|登录/.test(
    searchable,
  )
    ? 'auth'
    : 'network';
}

function safelyReportConnectionError(
  subscription: StreamSubscription,
  error: AgentStreamConnectError,
): void {
  try {
    subscription.onConnectionError?.(error);
  } catch {
    // 消费方错误不得暴露原始连接异常，也不得中断 Socket 清理/重连。
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
