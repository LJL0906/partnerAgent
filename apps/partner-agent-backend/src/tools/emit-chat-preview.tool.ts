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
    label: '提交行动意图',
    description:
      '提交一个行动结构化意图。明确且唯一的行动使用 confidence >= 0.85、uncertainty 留空，服务端会在对话完成后通过审计事务自动写入；不确定意图使用较低 confidence 并写明 uncertainty，多个候选分别提交，仅供用户通过聊天选择。content 只允许 title、description、planned_at、deadline_at、timezone、priority、confidence、uncertainty、risk_summary，不要添加其他字段；title 和 confidence 必填。planned_at/deadline_at 使用带 Z 或时区偏移的 RFC 3339 时间，timezone 使用 IANA 名称，priority 仅限 low/medium/high，confidence 为 0 到 1 的数字。source_refs 仅可引用当前输入来源；applied、状态和服务端 ID 不得提交。',
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
