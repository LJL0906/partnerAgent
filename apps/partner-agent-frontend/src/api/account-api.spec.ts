import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountRequest, isValidAccountPassword, isValidAccountUsername, normalizeAccountUsername } from './account-api';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('./config', () => ({ apiConfig: { serverUrl: 'http://localhost:3000' } }));
const fetchMock = vi.fn();
const registerMessage = '密码须为 6–128 个字符，且至少包含一个英文字母和一个数字。';
const loginMessage = '密码须为 6–128 个字符。';

describe('account username policy', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['abc', 'User_123', 'a'.repeat(32)])('accepts valid usernames: %s', (username) => {
    expect(isValidAccountUsername(username)).toBe(true);
  });

  it.each(['ab', 'a'.repeat(33), '中文用户', 'user-name', 'user name'])('rejects invalid usernames: %s', (username) => {
    expect(isValidAccountUsername(username)).toBe(false);
  });

  it('normalizes usernames before submission', () => {
    expect(normalizeAccountUsername('  User_123  ')).toBe('user_123');
  });

  it('rejects invalid usernames before making a request', async () => {
    await expect(accountRequest('login', { username: 'bad-name', password: 'abc123' })).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('account password policy', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['a12345', 'A'.repeat(127) + '1', 'a1' + '😀'.repeat(126)])('accepts a valid registration password: %s', (password) => {
    expect(isValidAccountPassword(password)).toBe(true);
  });

  it.each(['a1234', 'abcdef', '123456', '中文密码测试123', 'a1' + '😀'.repeat(127)])('rejects an invalid registration password: %s', (password) => {
    expect(isValidAccountPassword(password)).toBe(false);
  });

  it.each(['a lengthy test password', '123456', '😀'.repeat(128)])('sends a legacy login password unchanged: %s', async (password) => {
    const tokens = { access_token: 'test-access' };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(tokens), { status: 200 }));
    expect(isValidAccountPassword(password, false)).toBe(true);
    await expect(accountRequest('login', { username: 'test_user', password })).resolves.toEqual(tokens);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/api/v1/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ username: 'test_user', password }),
    }));
  });

  it.each(['a lengthy test password', '123456'])('rejects legacy password when registering: %s', async (password) => {
    await expect(accountRequest('register', { username: 'test_user', password })).rejects.toMatchObject({
      message: registerMessage, status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['a1234', '😀'.repeat(129)])('rejects login passwords outside the code-point length limit: %s', async (password) => {
    expect(isValidAccountPassword(password, false)).toBe(false);
    await expect(accountRequest('login', { username: 'test_user', password })).rejects.toMatchObject({
      message: loginMessage, status: 400,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [409, '用户名已被占用，请更换一个用户名。'],
    [429, '尝试过于频繁，请稍后再试。'],
    [503, '暂时无法完成请求，请稍后再试。'],
  ])('keeps HTTP %s failure messages specific and safe', async (status, message) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status }));
    await expect(accountRequest('register', { username: 'test_user', password: 'abc123' })).rejects.toMatchObject({ message, status });
  });

  it('uses a network failure message without confusing it with an HTTP error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(accountRequest('login', { username: 'test_user', password: 'abc123' })).rejects.toMatchObject({
      message: '无法连接服务，请检查网络后重试。', status: 0,
    });
  });

  it.each(['register', 'login'] as const)('uses the correct password hint for a %s HTTP 400 response', async (action) => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
    await expect(accountRequest(action, { username: 'test_user', password: 'abc123' })).rejects.toMatchObject({
      message: `用户名须为 3–32 位字母、数字或下划线，${action === 'register' ? registerMessage : loginMessage}`,
      status: 400,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
