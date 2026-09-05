import type { DataSource } from 'typeorm';

export interface Account {
  id: string;
  username: string;
  password_hash: string;
}
export interface LoginSession {
  id: string;
  user_id: string;
  refresh_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/** Account tables share the existing database connection and user identity. */
export class AccountStore {
  private readonly revocations = new Set<(id: string) => void>();
  onRevoke(listener: (id: string) => void): () => void {
    this.revocations.add(listener);
    return () => this.revocations.delete(listener);
  }
  private readonly accounts = new Map<string, Account>();
  private readonly sessions = new Map<string, LoginSession>();
  constructor(private readonly database?: DataSource) {}

  async create(account: Account): Promise<boolean> {
    if (!this.database) {
      if (this.accounts.has(account.username)) return false;
      this.accounts.set(account.username, { ...account });
      return true;
    }
    try {
      await this.database.transaction(async (manager) => {
        await manager.query(
          'insert into users(id, display_name, timezone, created_at, updated_at) values($1,$2,$3,now(),now())',
          [account.id, account.username, 'Asia/Shanghai'],
        );
        await manager.query(
          'insert into account_credentials(user_id,username,password_hash) values($1,$2,$3)',
          [account.id, account.username, account.password_hash],
        );
      });
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return false;
      throw error;
    }
  }

  async find(username: string): Promise<Account | undefined> {
    if (!this.database) return this.accounts.get(username);
    return (
      await this.database.query(
        'select user_id as id,username,password_hash from account_credentials where username=$1',
        [username],
      )
    )[0];
  }

  async findById(id: string): Promise<Account | undefined> {
    if (!this.database)
      return [...this.accounts.values()].find((account) => account.id === id);
    return (
      await this.database.query(
        'select user_id as id,username,password_hash from account_credentials where user_id=$1',
        [id],
      )
    )[0];
  }

  async saveSession(session: LoginSession): Promise<void> {
    if (!this.database) {
      this.sessions.set(session.id, { ...session });
      return;
    }
    await this.database.query(
      'insert into account_sessions(id,user_id,refresh_hash,expires_at) values($1,$2,$3,$4)',
      [session.id, session.user_id, session.refresh_hash, session.expires_at],
    );
  }

  async getSession(id: string): Promise<LoginSession | undefined> {
    if (!this.database) return this.sessions.get(id);
    return (
      await this.database.query(
        'select id,user_id,refresh_hash,expires_at,revoked_at from account_sessions where id=$1',
        [id],
      )
    )[0];
  }

  async rotate(
    id: string,
    oldHash: string,
    nextHash: string,
  ): Promise<LoginSession | undefined> {
    if (!this.database) {
      const session = this.sessions.get(id);
      if (
        !session ||
        session.revoked_at ||
        session.expires_at.getTime() <= Date.now() ||
        session.refresh_hash !== oldHash
      )
        return;
      session.refresh_hash = nextHash;
      return { ...session };
    }
    const [rows] = await this.database.query(
      'update account_sessions set refresh_hash=$3 where id=$1 and refresh_hash=$2 and revoked_at is null and expires_at>now() returning id,user_id,refresh_hash,expires_at,revoked_at',
      [id, oldHash, nextHash],
    );
    return rows[0];
  }

  async revoke(id: string, hash: string): Promise<void> {
    if (!this.database) {
      const session = this.sessions.get(id);
      if (session?.refresh_hash === hash) {
        session.revoked_at = new Date();
        for (const listener of this.revocations) listener(id);
      }
      return;
    }
    const [rows] = await this.database.query(
      'update account_sessions set revoked_at=now() where id=$1 and refresh_hash=$2 and revoked_at is null returning id',
      [id, hash],
    );
    if (rows.length) for (const listener of this.revocations) listener(id);
  }
}
