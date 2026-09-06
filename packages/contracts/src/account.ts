/** Authentication endpoints use their own payloads, outside Local Core command envelopes. */
export interface AccountCredentialsPayload {
  username: string;
  password: string;
}

export interface AccountPublicUser {
  id: string;
  username: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 客户端身份缓存必须保留该对象；username 不是 owner 隔离键。 */
export function isAccountPublicUser(value: unknown): value is AccountPublicUser {
  return isRecord(value)
    && Object.keys(value).every((key) => key === 'id' || key === 'username')
    && typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.username === 'string'
    && value.username.trim().length > 0;
}

/** JWT sub 是可信主体时，必须与账户响应的 user.id 完全一致。 */
export function isAccountIdentityConsistent(
  user: AccountPublicUser,
  jwtSubject: string,
): boolean {
  return isAccountPublicUser(user) && jwtSubject.length > 0 && user.id === jwtSubject;
}

export interface AccountLoginResult {
  access_token: string;
  /** Native only; Web receives its refresh credential in an HttpOnly cookie. */
  refresh_token?: string;
  /** Unix timestamp in milliseconds. */
  expires_at: number;
  refresh_expires_at: number;
  user: AccountPublicUser;
}
