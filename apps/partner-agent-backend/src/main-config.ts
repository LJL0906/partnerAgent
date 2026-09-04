export interface ServerBinding {
  host: string;
  port: number;
}

export function parseServerBinding(environment: {
  HOST?: string;
  PORT?: string;
}): ServerBinding {
  const host = environment.HOST?.trim() || '127.0.0.1';
  const rawPort = environment.PORT?.trim();
  const port = rawPort === undefined ? 3000 : Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT 必须是 1 到 65535 之间的整数');
  }

  return { host, port };
}
