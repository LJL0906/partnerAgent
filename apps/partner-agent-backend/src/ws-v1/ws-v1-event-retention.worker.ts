import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

export interface WsV1RetentionOptions {
  count: number;
  ageMs: number;
  batchSize: number;
  intervalMs: number;
}

export const DEFAULT_WS_V1_RETENTION: WsV1RetentionOptions = {
  count: 100,
  ageMs: 24 * 60 * 60 * 1_000,
  batchSize: 500,
  intervalMs: 60_000,
};

export class WsV1EventRetentionWorker {
  private readonly logger = new Logger(WsV1EventRetentionWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleaning = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly options: WsV1RetentionOptions = DEFAULT_WS_V1_RETENTION,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.runOnce(), this.options.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runOnce(now = new Date()): Promise<number> {
    if (this.cleaning) return 0;
    this.cleaning = true;
    try {
      const rows = (await this.dataSource.query(
        `with candidates as (
           select event.event_id
           from ws_v1_events event
           join ws_v1_event_streams stream on stream.stream_key = event.stream_key
           where event.created_at < $1
              or event.stream_position <= stream.last_position - $2::bigint
           order by event.created_at asc, event.event_id asc
           limit $3
           for update of event skip locked
         )
         delete from ws_v1_events event
         using candidates
         where event.event_id = candidates.event_id
         returning event.event_id`,
        [
          new Date(now.getTime() - this.options.ageMs),
          this.options.count,
          this.options.batchSize,
        ],
      )) as Array<{ event_id: string }>;
      return rows.length;
    } catch {
      this.logger.warn('WS v1 event retention batch failed');
      return 0;
    } finally {
      this.cleaning = false;
    }
  }
}
