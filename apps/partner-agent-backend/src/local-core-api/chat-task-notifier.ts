import { Logger } from '@nestjs/common';
import { Client, type Notification } from 'pg';
import type { DataSource } from 'typeorm';

export const CHAT_TASK_NOTIFICATION_CHANNEL = 'partner_agent_chat_task';
const DEFAULT_RECONNECT_DELAY_MS = 1_000;

export interface ChatTaskListenerClient {
  connect(): Promise<unknown>;
  query(query: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: 'notification', listener: (message: Notification) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'end', listener: () => void): this;
  removeAllListeners(): this;
}

export abstract class ChatTaskNotifier {
  abstract start(onWakeup: (taskId: string) => void): Promise<void>;
  abstract notify(taskId: string): Promise<void>;
  abstract stop(): Promise<void>;
}

export class NoopChatTaskNotifier extends ChatTaskNotifier {
  async start(_onWakeup: (taskId: string) => void): Promise<void> {}
  async notify(_taskId: string): Promise<void> {}
  async stop(): Promise<void> {}
}

export class PostgresChatTaskNotifier extends ChatTaskNotifier {
  private readonly logger = new Logger(PostgresChatTaskNotifier.name);
  private client?: ChatTaskListenerClient;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private connecting?: Promise<void>;
  private onWakeup?: (taskId: string) => void;
  private stopping = false;

  constructor(
    private readonly dataSource: DataSource,
    databaseUrl: string,
    private readonly reconnectDelayMs = DEFAULT_RECONNECT_DELAY_MS,
    private readonly createClient: () => ChatTaskListenerClient = () =>
      new Client({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5_000,
        application_name: 'partner-agent-chat-task-listener',
      }),
  ) {
    super();
  }

  async start(onWakeup: (taskId: string) => void): Promise<void> {
    this.onWakeup = onWakeup;
    this.stopping = false;
    await this.ensureConnected();
  }

  async notify(taskId: string): Promise<void> {
    try {
      if (!this.dataSource.isInitialized) return;
      await this.dataSource.query('select pg_notify($1, $2)', [
        CHAT_TASK_NOTIFICATION_CHANNEL,
        taskId,
      ]);
    } catch {
      this.logger.warn('ChatTask notification failed; polling will recover');
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.onWakeup = undefined;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const client = this.client;
    this.client = undefined;
    client?.removeAllListeners();
    if (client) await client.end().catch(() => undefined);
    await this.connecting?.catch(() => undefined);
  }

  private async ensureConnected(): Promise<void> {
    if (this.stopping || this.client || this.connecting) {
      await this.connecting;
      return;
    }
    const attempt = this.openListener()
      .catch(() => {
        this.logger.warn('ChatTask LISTEN unavailable; polling remains active');
        this.scheduleReconnect();
      })
      .finally(() => {
        if (this.connecting === attempt) this.connecting = undefined;
      });
    this.connecting = attempt;
    await attempt;
  }

  private async openListener(): Promise<void> {
    const client = this.createClient();
    this.client = client;
    client.on('notification', (message) => {
      if (
        message.channel !== CHAT_TASK_NOTIFICATION_CHANNEL ||
        !message.payload
      )
        return;
      this.onWakeup?.(message.payload);
    });
    client.on('error', () => {
      this.logger.warn('ChatTask LISTEN disconnected; reconnect scheduled');
      this.handleDisconnect(client);
    });
    client.on('end', () => this.handleDisconnect(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHAT_TASK_NOTIFICATION_CHANNEL}`);
      if (this.stopping) {
        this.client = undefined;
        client.removeAllListeners();
        await client.end().catch(() => undefined);
      }
    } catch (error) {
      if (this.client === client) this.client = undefined;
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      throw error;
    }
  }

  private handleDisconnect(client: ChatTaskListenerClient): void {
    if (this.client !== client) return;
    this.client = undefined;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected();
    }, this.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }
}
