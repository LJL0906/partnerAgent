/** Refresh credentials remain in an HttpOnly cookie; JavaScript never reads them. */
export const refreshStorage = {
  async get(): Promise<string | undefined> { return '@cookie'; },
  async set(_token: string): Promise<void> {},
  async remove(): Promise<void> {},
};
