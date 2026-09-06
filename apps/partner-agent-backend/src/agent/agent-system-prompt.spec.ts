import { describe, expect, it } from 'vitest';
import {
  AGENT_SYSTEM_PROMPT_VERSION,
  buildAgentSystemPrompt,
} from './agent-system-prompt.js';

describe('agent system prompt', () => {
  it('is explicitly versioned and defines the chat message protocol', () => {
    const prompt = buildAgentSystemPrompt();

    expect(AGENT_SYSTEM_PROMPT_VERSION).toMatch(/^v\d+$/);
    expect(prompt).toContain(`版本: ${AGENT_SYSTEM_PROMPT_VERSION}`);
    expect(prompt).toContain('消息类型');
    expect(prompt).toContain('assistant');
    expect(prompt).toContain('toolCall');
    expect(prompt).toContain('toolResult');
  });

  it('requires wrapper tools and safe thinking summaries without exposing hidden reasoning', () => {
    const prompt = buildAgentSystemPrompt();

    expect(prompt).toContain('工具包装');
    expect(prompt).toContain('不得绕过正式协议');
    expect(prompt).toContain('思考摘要');
    expect(prompt).toContain('不得输出原始推理');
    expect(prompt).toContain('敏感数据');
  });

  it('constrains candidate previews and forbids pretending persistence', () => {
    const prompt = buildAgentSystemPrompt();

    expect(prompt).toContain('候选预览');
    expect(prompt).toContain('preview');
    expect(prompt).toContain('applied: false');
    expect(prompt).toContain('禁止虚构入库');
    expect(prompt).toContain('确认事务');
  });

  it('returns a fresh immutable prompt value for each assembly', () => {
    const first = buildAgentSystemPrompt();
    const second = buildAgentSystemPrompt();

    expect(first).toBe(second);
  });
});


