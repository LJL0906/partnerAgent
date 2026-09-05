import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignJWT } from 'jose';
import type { AccountLoginResult } from '@partner-agent/contracts';
import { AccountStore, type Account, type LoginSession } from './账户存储.js';
import {
  AccountRateLimit,
  credentials,
  hashPassword,
  verifyPassword,
} from './账户安全.js';

export const ACCESS_SECONDS = 900;
export const REFRESH_SECONDS = 7 * 24 * 3600;
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const makeRefresh = (id: string) =>
  `${id}.${randomBytes(32).toString('base64url')}`;

export interface AccountTokens extends AccountLoginResult {
  refresh_token: string;
}

@Injectable()
export class AccountService {
  private readonly limiter = new AccountRateLimit();
  private readonly secret: Uint8Array;
  // Fixed well-formed dummy hash makes an unknown account take the same KDF path.
  private readonly dummyHash = `scrypt-v1:${'0'.repeat(32)}:${'0'.repeat(128)}`;
  constructor(
    private readonly store: AccountStore,
    config: ConfigService,
  ) {
    this.secret = new TextEncoder().encode(
      config.getOrThrow<string>('AUTH_JWT_SECRET'),
    );
  }

  async register(body: unknown, ip: string): Promise<AccountTokens> {
    this.limiter.check(`credentials:${ip}`);
    const input = credentials(body);
    const passwordHash = await this.limiter.hash(() =>
      hashPassword(input.password),
    );
    const account = {
      id: randomUUID(),
      username: input.username,
      password_hash: passwordHash,
    };
    if (!(await this.store.create(account)))
      throw new ConflictException('该用户名暂不可用，请更换。');
    return this.start(account);
  }

  async login(body: unknown, ip: string): Promise<AccountTokens> {
    this.limiter.check(`credentials:${ip}`);
    const input = credentials(body);
    this.limiter.check(`login:${ip}:${input.username}`, 10);
    const account = await this.store.find(input.username);
    const valid = await this.limiter.hash(() =>
      verifyPassword(input.password, account?.password_hash ?? this.dummyHash),
    );
    if (!valid || !account)
      throw new UnauthorizedException('用户名或密码不正确。');
    return this.start(account);
  }

  async refresh(raw: unknown, ip: string): Promise<AccountTokens> {
    this.limiter.check(`refresh:${ip}`, 120);
    const token = this.refreshValue(raw);
    const id = token.slice(0, 36);
    const next = makeRefresh(id);
    const session = await this.store.rotate(id, digest(token), digest(next));
    if (!session) throw new UnauthorizedException('登录已失效，请重新登录。');
    const account = await this.store.findById(session.user_id);
    if (!account) throw new UnauthorizedException('登录已失效，请重新登录。');
    return this.tokens(account, session, next);
  }

  async logout(raw: unknown): Promise<void> {
    if (raw === undefined) return;
    const token = this.refreshValue(raw);
    await this.store.revoke(token.slice(0, 36), digest(token));
  }

  async me(id: string): Promise<{ id: string; username: string }> {
    const account = await this.store.findById(id);
    if (!account) throw new UnauthorizedException('该身份尚未绑定登录账户。');
    return { id: account.id, username: account.username };
  }

  private refreshValue(value: unknown): string {
    if (
      typeof value !== 'string' ||
      !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(value) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\./.test(
        value,
      )
    )
      throw new UnauthorizedException('登录已失效，请重新登录。');
    return value;
  }

  private async start(account: Account): Promise<AccountTokens> {
    const id = randomUUID();
    const refresh = makeRefresh(id);
    const session: LoginSession = {
      id,
      user_id: account.id,
      refresh_hash: digest(refresh),
      expires_at: new Date(Date.now() + REFRESH_SECONDS * 1000),
      revoked_at: null,
    };
    await this.store.saveSession(session);
    return this.tokens(account, session, refresh);
  }

  private async tokens(
    account: Account,
    session: LoginSession,
    refresh: string,
  ): Promise<AccountTokens> {
    const expires = Math.min(
      Math.floor(Date.now() / 1000) + ACCESS_SECONDS,
      Math.floor(session.expires_at.getTime() / 1000),
    );
    const access = await new SignJWT({ sid: session.id })
      .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
      .setSubject(account.id)
      .setIssuer('partner-agent')
      .setAudience('partner-agent')
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(this.secret);
    return {
      access_token: access,
      refresh_token: refresh,
      expires_at: expires * 1000,
      refresh_expires_at: session.expires_at.getTime(),
      user: { id: account.id, username: account.username },
    };
  }
}
