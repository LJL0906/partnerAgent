import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName: string | null;

  @Column({ type: 'text', default: 'Asia/Shanghai' })
  timezone: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
