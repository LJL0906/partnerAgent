import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import { SignJWT } from 'jose';

const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_EXPIRY_SECONDS = 86_400;

export interface DevJwtOptions {
  subject: string;
  expiresInSeconds: number;
}

export function parseDevJwtArgs(args: readonly string[]): DevJwtOptions {
  let subject: string | undefined;
  let expiresIn: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];

    if (option !== '--subject' && option !== '--expires-in') {
      throw new Error(`未知参数：${option}`);
    }
    if (!value || value.startsWith('--')) {
      throw new Error(`${option} 缺少值`);
    }

    if (option === '--subject') {
      if (subject !== undefined) {
        throw new Error('--subject 不能重复');
      }
      subject = value.trim();
    } else {
      if (expiresIn !== undefined) {
        throw new Error('--expires-in 不能重复');
      }
      expiresIn = value;
    }
    index += 1;
  }

  if (!subject) {
    throw new Error('必须提供非空的 --subject');
  }
  if (!expiresIn || !/^\d+$/.test(expiresIn)) {
    throw new Error('--expires-in 必须是正整数秒数');
  }

  const expiresInSeconds = Number(expiresIn);
  if (
    !Number.isSafeInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > MAXIMUM_EXPIRY_SECONDS
  ) {
    throw new Error(
      `--expires-in 必须在 1 到 ${MAXIMUM_EXPIRY_SECONDS} 秒之间`,
    );
  }

  return { subject, expiresInSeconds };
}

export async function generateDevJwt(
  options: DevJwtOptions,
  secretValue: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (!secretValue) {
    throw new Error('AUTH_JWT_SECRET 未配置');
  }

  const secret = new TextEncoder().encode(secretValue);
  if (secret.byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error(
      `AUTH_JWT_SECRET 长度不能少于 ${MINIMUM_SECRET_BYTES} 字节`,
    );
  }

  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + options.expiresInSeconds)
    .sign(secret);
}

export async function runDevJwt(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return generateDevJwt(parseDevJwtArgs(args), environment.AUTH_JWT_SECRET);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runDevJwt(process.argv.slice(2))
    .then((token) => process.stdout.write(`${token}\n`))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '生成令牌失败';
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
