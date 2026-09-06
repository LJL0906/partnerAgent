// @ts-expect-error Vitest executes this Node-only source guard; Expo excludes Node ambient types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sources = [
  new URL('./components/chat-input.tsx', import.meta.url),
  new URL('./use-chat.ts', import.meta.url),
  new URL('./chat-message-submission.ts', import.meta.url),
].map((file) => readFileSync(file, 'utf8'));

describe('chat output mode contract source', () => {
  it('does not expose or forward a manual action-preview mode in the UI flow', () => {
    const chatInput = sources[0];
    const useChat = sources[1];
    const submission = sources[2];

    expect(chatInput).not.toContain('行动预览');
    expect(chatInput).not.toContain('setOutputMode');
    expect(useChat).not.toContain('ChatOutputMode');
    expect(submission).not.toContain('SubmitTextOutputMode');
    expect(submission).toContain("outputMode: 'chat'");
  });
});
