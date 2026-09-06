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

  it('constrains action intents and leaves persistence claims to the server transaction', () => {
    const prompt = buildAgentSystemPrompt();

    expect(prompt).toContain('行动意图');
    expect(prompt).toContain('preview');
    expect(prompt).toContain('applied 由服务端补齐为 false');
    expect(prompt).toContain('不得作为工具参数提交');
    expect(prompt).toContain('禁止虚构入库');
    expect(prompt).toContain('服务端事务');
  });

  it('lets the model recognize action intent without forcing previews for normal chat', () => {
    const prompt = buildAgentSystemPrompt({ previewMode: 'auto' });

    expect(prompt).toContain('明确行动意图');
    expect(prompt).toContain('意图不明确');
    expect(prompt).toContain('只提交一个');
    expect(prompt).toContain('confidence >= 0.85');
    expect(prompt).toContain('多个互斥候选');
    expect(prompt).toContain('通过聊天');
    expect(prompt).toContain('不要调用 emit_chat_preview');
    expect(prompt).toContain('planned_at');
    expect(prompt).toContain('RFC 3339');
    expect(prompt).toContain('不得添加提醒时间、状态或其他字段');
    expect(prompt).toContain('服务端自动写入');
    expect(prompt).toContain('最终选择即为授权');
    expect(prompt).toContain('不要再次询问或确认');
  });

  it('returns a fresh immutable prompt value for each assembly', () => {
    const first = buildAgentSystemPrompt();
    const second = buildAgentSystemPrompt();

    expect(first).toBe(second);
  });

  it('uses transient todos only for complex tasks and closes them before the answer', () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain('update_task_todo');
    expect(prompt).toContain('复杂任务');
    expect(prompt).toContain('简单问答、闲聊和单步任务不要调用');
    expect(prompt).toContain('完成回复前将全部条目标为 completed');
  });

  it('keeps user-facing time and status descriptions concise and Chinese', () => {
    const prompt = buildAgentSystemPrompt();

    expect(prompt).toContain('默认按中国标准时间理解');
    expect(prompt).toContain('不显示 Asia/Shanghai、UTC、GMT、RFC 3339 或 AM/PM');
    expect(prompt).toContain('面向用户的标签、状态、类型、日期和星期统一使用中文');
    expect(prompt).toContain('结构化工具参数仍遵守协议字段和枚举');
  });
});


