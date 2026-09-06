export const REAL_POSTGRES_TEST_CONFIRMATION =
  'I_ACKNOWLEDGE_DEDICATED_REAL_POSTGRES_TEST_DATABASE';

export function assertDedicatedRealPostgresTestDatabase(
  databaseUrl: string,
  confirmation: string | undefined,
): string {
  if (confirmation !== REAL_POSTGRES_TEST_CONFIRMATION) {
    throw new Error(
      `REAL_POSTGRES_TEST_CONFIRM 必须精确设置为 ${REAL_POSTGRES_TEST_CONFIRMATION}`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('REAL_POSTGRES_DATABASE_URL 不是有效 URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('REAL_POSTGRES_DATABASE_URL 必须使用 PostgreSQL 协议');
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !databaseName ||
    databaseName.includes('/') ||
    !/(?:^|[_-])(test|verify)(?:$|[_-])/i.test(databaseName)
  ) {
    throw new Error('REAL_POSTGRES_DATABASE_URL 必须指向专用测试数据库');
  }
  return databaseUrl;
}
