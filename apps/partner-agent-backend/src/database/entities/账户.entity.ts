import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('account_credentials')
export class AccountCredentialEntity {
  @PrimaryColumn({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ type: 'text', unique: true }) username: string;
  @Column({ name: 'password_hash', type: 'text' }) passwordHash: string;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
}

@Entity('account_sessions')
export class AccountSessionEntity {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'user_id', type: 'text' }) userId: string;
  @Column({ name: 'refresh_hash', type: 'text' }) refreshHash: string;
  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
