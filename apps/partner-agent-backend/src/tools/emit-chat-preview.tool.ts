import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';
import {
  CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA,
  parseChatPreviewProposalV1,
} from '@partner-agent/contracts';
import {
  StructuredPreviewOutputError,
  type ChatPreviewOutputCollector,
} from '../agent/chat-preview-output.js';

export const emitChatPreviewParameters =
  CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA as typeof CHAT_PREVIEW_PROPOSAL_V1_JSON_SCHEMA & TSchema;

type EmitChatPreviewDetails = {
  status: 'preview_collected';
  count: number;
};

export function createEmitChatPreviewTool(
  collector: ChatPreviewOutputCollector,
): AgentTool<typeof emitChatPreviewParameters, EmitChatPreviewDetails> {
  return {
    name: 'emit_chat_preview',
    label: '生成行动预览',
    description:
      '提交一个待用户确认、尚未生效的行动结构化预览。仅可引用当前输入来源。',
    parameters: emitChatPreviewParameters,
    executionMode: 'sequential',
    prepareArguments: (raw) => {
      try {
        return parseChatPreviewProposalV1(raw);
      } catch {
        collector.noteRejectedAttempt();
        throw new StructuredPreviewOutputError(
          'STRUCTURED_PREVIEW_INVALID',
          '结构化预览参数未通过安全契约校验。',
        );
      }
    },
    execute: async (toolCallId, params, signal) => {
      if (signal?.aborted) throw new Error('结构化预览输出已取消。');
      collector.collect(params, toolCallId);
      return {
        content: [{ type: 'text', text: '结构化预览已暂存。' }],
        details: { status: 'preview_collected', count: collector.count },
      };
    },
  };
}
