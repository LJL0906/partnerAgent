import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { AccountStore, type LoginSession } from './account-store.js';

const session: LoginSession = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  refresh_hash: 'old-hash',
  expires_at: new Date(Date.now() + 60_000),
  revoked_at: null,
};

describe('AccountStore database result handling', () => {
  it('returns false only for the account username unique constraint', async () => {
    const transaction = vi.fn().mockRejectedValue({ code: '23505', constraint: 'account_credentials_username_key', detail: 'duplicate key value' });
    const store = new AccountStore({ transaction } as unknown as DataSource);

    await expect(store.create({ id: session.user_id, username: 'user', password_hash: 'hash' })).resolves.toBe(false);
  });

  it.each([
    { code: '23505', constraint: 'users_display_name_key', detail: 'Key (username)=(user) already exists.' },
    { code: '23505', constraint: undefined, detail: 'Key (email)=(user@example.com) already exists.' },
    { code: '23503', constraint: 'users_owner_id_fkey', detail: 'Key (owner_id)=(id) is not present.' },
  ])('throws non-username database errors instead of reporting username occupied: %o', async (error) => {
    const transaction = vi.fn().mockRejectedValue(error);
    const store = new AccountStore({ transaction } as unknown as DataSource);

    await expect(store.create({ id: session.user_id, username: 'user', password_hash: 'hash' })).rejects.toEqual(error);
  });

  it('returns the rotated session from the row array returned by DataSource.query', async () => {
    const query = vi.fn().mockResolvedValue([[{ ...session, refresh_hash: 'next-hash' }], 1]);
    const store = new AccountStore({ query } as unknown as DataSource);

    await expect(store.rotate(session.id, 'old-hash', 'next-hash')).resolves.toEqual({
      ...session,
      refresh_hash: 'next-hash',
    });
    expect(query).toHaveBeenCalledOnce();
  });

  it('notifies revocation listeners when the update returns a row', async () => {
    const query = vi.fn().mockResolvedValue([[{ id: session.id }], 1]);
    const store = new AccountStore({ query } as unknown as DataSource);
    const onRevoke = vi.fn();
    store.onRevoke(onRevoke);

    await store.revoke(session.id, 'old-hash');

    expect(onRevoke).toHaveBeenCalledWith(session.id);
  });
});
