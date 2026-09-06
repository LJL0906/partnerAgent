/** Authentication endpoints use their own payloads, outside Local Core command envelopes. */
export interface AccountCredentialsPayload {
  username: string;
  password: string;
}

export interface AccountPublicUser {
  id: string;
  username: string;
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
