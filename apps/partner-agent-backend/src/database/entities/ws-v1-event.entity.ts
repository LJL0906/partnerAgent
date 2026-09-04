import type { ServerPushEventV1 } from '@partner-agent/contracts';
import { Column, Entity, Index, PrimaryColumn, Unique } from 'typeorm';

@Entity({ name: 'ws_v1_events' })
@Unique('ws_v1_events_stream_position_key', ['streamKey', 'streamPosition'])
@Index('ws_v1_events_stream_created_idx', ['streamKey', 'createdAt'])
export class WsV1EventEntity {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' }) eventId: string;
  @Column({ name: 'stream_key', type: 'text' }) streamKey: string;
  @Column({ name: 'stream_position', type: 'bigint' })
  streamPosition: string;
  @Column({ name: 'publisher_instance_id', type: 'uuid' })
  publisherInstanceId: string;
  @Column({ name: 'wire_payload', type: 'jsonb' })
  wirePayload: ServerPushEventV1;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
