import { describe, expect, it } from 'vitest';
import { CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA } from '@partner-agent/contracts';
import { ChatPreviewOutputCollector } from '../agent/chat-preview-output.js';
import { createEmitChatPreviewTool } from './emit-chat-preview.tool.js';

describe('emit_chat_preview', () => {
  it('collects only into its current run and returns no preview body', async () => {
    const collector = new ChatPreviewOutputCollector({
      taskId: 'task-tool',
      allowedSourceRefs: [{ kind: 'original_record', id: 'record-tool' }],
    });
    const tool = createEmitChatPreviewTool(collector);

    expect(tool.parameters).toBe(CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA);

    const result = await tool.execute('call-1', {
      schema_version: 1,
      kind: 'action',
      source_refs: [{ kind: 'original_record', id: 'record-tool' }],
      content: { title: '确认行程', confidence: 0.8 },
    });

    expect(tool.name).toBe('emit_chat_preview');
    expect(result).toEqual({
      content: [{ type: 'text', text: '结构化预览已暂存。' }],
      details: { status: 'preview_collected', count: 1 },
    });
    expect(JSON.stringify(result)).not.toContain('确认行程');
    expect(collector.complete()).toHaveLength(1);
  });
});
