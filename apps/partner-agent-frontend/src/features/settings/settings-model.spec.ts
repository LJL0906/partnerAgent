import { describe, expect, it } from 'vitest';

import { getSessionStatus, settingsSections } from './settings-model';

describe('settings model', () => {
  it('provides the setting groups shown on the settings home', () => {
    expect(settingsSections.map((section) => section.title)).toEqual([
      '账户与安全',
      'AI 与模型',
      '通用设置',
      '关于紫灵',
    ]);
  });

  it('maps authenticated and expired auth states to user-facing session status', () => {
    expect(getSessionStatus('authenticated')).toEqual({ label: '已连接', tone: 'success' });
    expect(getSessionStatus('expired')).toEqual({ label: '已过期', tone: 'danger' });
  });
});

