// @ts-expect-error Vitest executes this Node-only source guard; Expo excludes Node ambient types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = [
  new URL('./components/chat-input.tsx', import.meta.url),
  new URL('./use-chat.ts', import.meta.url),
].map((file) => readFileSync(file, 'utf8'));

describe('chat output mode contract source', () => {
  it('uses ChatOutputMode instead of mirroring its literal union', () => {
    for (const source of sources) {
      expect(source).toContain('ChatOutputMode');
      expect(source).not.toMatch(/'chat'\s*\|\s*'structured_preview'/);
    }
  });
});
