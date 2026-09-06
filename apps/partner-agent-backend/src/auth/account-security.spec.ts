import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { credentials } from './account-security.js';

describe('account密码安全规则', () => {
  it.each([
    ['abc123', '最短合法密码'],
    ['A1b2c3', '混合大小写密码'],
    ['a'.repeat(127) + '1', '最长合法密码'],
  ])('接受%s（%s）', (password) => {
    expect(credentials({ username: 'valid_user', password })).toEqual({
      username: 'valid_user',
      password,
    });
  });

  it.each([
    ['少于 6 位', 'a1b2c'],
    ['超过 128 位', 'a'.repeat(128) + '1'],
    ['不含英文字母', '123456'],
    ['不含数字', 'abcdef'],
    ['长纯字母', 'abcdefghijklmnop'],
    ['长纯数字', '1234567890123456'],
    ['非英文字母', '中文密码123456'],
  ])('拒绝%s密码', (_label, password) => {
    expect(() => credentials({ username: 'valid_user', password })).toThrow(
      BadRequestException,
    );
  });
  it.each(['abcdefghijklmnop', 'legacy password phrase'])('登录允许历史密码: %s', (password) => {
    expect(credentials({ username: 'valid_user', password }, false).password).toBe(password);
  });

  it.each(['a1b2c', 'a'.repeat(128) + '1'])('登录仍拒绝超出长度的密码', (password) => {
    expect(() => credentials({ username: 'valid_user', password }, false)).toThrow(BadRequestException);
  });
});
