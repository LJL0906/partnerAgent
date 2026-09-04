// 模型和隐私命令（第 8.4 节）

export type ProviderId = 'anthropic' | 'openai' | 'deepseek' | 'google' | 'local';

export interface ModelConfig {
  id: string;
  provider: ProviderId;
  base_url?: string;
  /** API Key 仅进入安全存储，绝不进入日志、导出或事件。 */
  api_key_ref?: string;
  model_id: string;
  /** 是否默认模型。 */
  is_default?: boolean;
  /** 排序（决定失败后的尝试顺序）。 */
  sort_order?: number;
  /** 支持的能力（能力发现）。 */
  capabilities?: Array<'chat' | 'vision' | 'embedding' | 'reasoning'>;
}

/** 新增或更新模型配置。API Key 仅进入安全存储。 */
export interface UpsertModelConfigPayload {
  config: ModelConfig;
}

/** 删除或停用模型配置。设置操作，不是业务确认。 */
export interface DeleteModelConfigPayload {
  model_config_id: string;
}

/** 调整模型列表顺序。用户设置操作。 */
export interface ReorderModelConfigsPayload {
  ordered_ids: string[];
}

/** 设置默认模型。用户设置操作。 */
export interface SetDefaultModelPayload {
  model_config_id: string;
}

export type ReasoningLevel = 'low' | 'medium' | 'high';

/** 设置当前消息的模型和推理等级。只影响当前消息。 */
export interface SetMessageModelSelectionPayload {
  message_id: string;
  model_config_id: string;
  reasoning_level: ReasoningLevel;
}

/** 测试地址、凭证、Model ID 和协议能力。不发送个人数据。 */
export interface TestModelConnectionPayload {
  provider: ProviderId;
  base_url?: string;
  api_key_ref?: string;
  model_id: string;
}

export interface TestModelConnectionResult {
  ok: boolean;
  latency_ms?: number;
  /** 能力发现结果。 */
  capabilities?: string[];
  error?: string;
}

/** 启动聊天响应、辅助解答、输入分析、摘要、复盘等模型任务。由 Local Core 组装上下文。 */
export interface StartBusinessModelTaskPayload {
  kind:
    | 'chat_response'
    | 'assistant_answer'
    | 'input_analysis'
    | 'idea_organize'
    | 'summary'
    | 'weekly_review';
  session_id?: string;
  context?: Record<string, unknown>;
}

/** 提交某次外发载荷的隐私决定。不等于业务变更确认。 */
export interface SubmitPrivacyDecisionPayload {
  egress_id: string;
  decision: 'allow' | 'redact' | 'block';
}

/** 外发策略可公开给客户端的敏感类别；只描述类别，不包含命中明文。 */
export const SENSITIVE_CATEGORIES = [
  'identity_document',
  'bank_card',
  'password',
  'api_key',
  'secret',
] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

/** 等待隐私决定时用于 REST/WS 恢复的安全摘要。 */
export interface PrivacyDecisionStatus {
  egress_id: string;
  categories: SensitiveCategory[];
  provider: string;
  model_id: string;
  expires_at: string;
}

/** 记录建议采纳、拒绝或暂不处理。不自动创建行动。 */
export interface RecordSuggestionFeedbackPayload {
  suggestion_id: string;
  feedback: 'accepted' | 'rejected' | 'later';
  reason?: string;
}
