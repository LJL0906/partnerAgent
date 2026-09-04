import { describe, expect, it } from 'vitest';
import { parseServerBinding } from './main-config.js';

describe('parseServerBinding', () => {
  it('defaults to loopback port 3000', () => {
    expect(parseServerBinding({})).toEqual({
      host: '127.0.0.1',
      port: 3000,
    });
  });

  it('accepts an explicit LAN host and valid port', () => {
    expect(parseServerBinding({ HOST: ' 0.0.0.0 ', PORT: ' 3100 ' })).toEqual({
      host: '0.0.0.0',
      port: 3100,
    });
  });

  it.each(['', '0', '65536', '3000.5', 'not-a-port'])(
    'rejects invalid PORT %j',
    (port) => {
      expect(() => parseServerBinding({ PORT: port })).toThrow(
        'PORT 必须是 1 到 65535 之间的整数',
      );
    },
  );
});
