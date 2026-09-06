import { describe, expect, it, vi } from 'vitest';

import { resolveSettingsReturnTarget, returnFromSettings } from './settings-return';

describe('settings return navigation', () => {
  it('returns directly to chat when settings was opened from chat', () => {
    const router = { back: vi.fn(), dismissTo: vi.fn() };

    returnFromSettings(router, resolveSettingsReturnTarget('chat'));

    expect(router.dismissTo).toHaveBeenCalledWith('/chat');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('uses ordinary history when settings has no supported source', () => {
    const router = { back: vi.fn(), dismissTo: vi.fn() };

    returnFromSettings(router, resolveSettingsReturnTarget('confirmations'));

    expect(router.back).toHaveBeenCalledOnce();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });
});
