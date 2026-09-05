import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, HttpException } from '@nestjs/common';

const derive = (password: string, salt: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt-v1:${salt}:${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [version, salt, hash] = encoded.split(':');
  if (
    version !== 'scrypt-v1' ||
    !/^[a-f0-9]{32}$/.test(salt ?? '') ||
    !/^[a-f0-9]{128}$/.test(hash ?? '')
  )
    return false;
  return timingSafeEqual(
    await derive(password, salt),
    Buffer.from(hash, 'hex'),
  );
}

export function credentials(body: unknown): {
  username: string;
  password: string;
} {
  const value = body as Record<string, unknown> | null;
  if (
    !value ||
    typeof value.username !== 'string' ||
    typeof value.password !== 'string'
  )
    throw new BadRequestException('请输入用户名和密码。');
  const username = value.username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(username))
    throw new BadRequestException('用户名须为 3–32 位英文字母、数字或下划线。');
  if (
    [...value.password].length < 12 ||
    [...value.password].length > 128 ||
    Buffer.byteLength(value.password) > 512
  )
    throw new BadRequestException('密码须为 12–128 个字符。');
  return { username, password: value.password };
}

/** Bounded per-process limiter: single-instance deployment; never trusts forwarded IP headers. */
export class AccountRateLimit {
  private readonly buckets = new Map<
    string,
    { count: number; until: number }
  >();
  private hashing = 0;
  check(key: string, limit = 30): void {
    const now = Date.now();
    for (const [id, bucket] of this.buckets)
      if (bucket.until <= now) this.buckets.delete(id);
    const bucket = this.buckets.get(key) ?? {
      count: 0,
      until: now + 15 * 60_000,
    };
    if (
      bucket.count >= limit ||
      (!this.buckets.has(key) && this.buckets.size >= 2000)
    )
      throw new HttpException('尝试过于频繁，请稍后再试。', 429);
    bucket.count++;
    this.buckets.set(key, bucket);
  }
  async hash<T>(action: () => Promise<T>): Promise<T> {
    if (this.hashing >= 4)
      throw new HttpException('服务繁忙，请稍后重试。', 429);
    this.hashing++;
    try {
      return await action();
    } finally {
      this.hashing--;
    }
  }
}
