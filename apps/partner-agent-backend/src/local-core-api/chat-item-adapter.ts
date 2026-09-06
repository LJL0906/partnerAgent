import type {
  ChatItem,
  ChatPreviewV1,
  SessionMessageDto,
  SessionToolView,
  TaskState,
} from '@partner-agent/contracts';
import {
  chatItemIds,
  createChatItemDefaults,
  sessionMessageStatusToChatItemStatus,
  SESSION_TOOL_STATUS_TO_CHAT_ITEM_STATUS,
  taskStateToChatItemStatus,
} from '@partner-agent/contracts';

export interface ChatTaskSnapshotRef {
  taskId: string;
  sessionId: string;
  operationId: string;
  state: TaskState;
  revision: number;
  updatedAt: Date;
  errorCode?: string;
  errorMessage?: string;
}

export interface ChatPreviewSnapshotRef {
  preview: ChatPreviewV1;
  sessionId: string;
  taskId: string;
  operationId: string;
  messageId: string;
  revision: number;
  createdAt: Date;
}

export interface ChatItemsSnapshotInput {
  messages: SessionMessageDto[];
  tasks: ChatTaskSnapshotRef[];
  toolViews: SessionToolView[];
  previews: ChatPreviewSnapshotRef[];
}

export function buildChatItemsSnapshot(input: ChatItemsSnapshotInput): ChatItem[] {
  return [
    ...input.messages.map(messageItem),
    ...input.tasks.flatMap(taskItems),
    ...input.toolViews.map(toolItem),
    ...input.previews.map(previewItem),
  ].sort(
    (left, right) =>
      left.created_at - right.created_at || left.id.localeCompare(right.id),
  );
}

function messageItem(message: SessionMessageDto): ChatItem {
  const timestamp = Date.parse(message.created_at);
  const id =
    message.role === 'assistant' && message.task_id
      ? chatItemIds.taskAssistant(message.task_id)
      : chatItemIds.message(message.id);
  return {
    schema_version: 1,
    id,
    type: 'message',
    status: sessionMessageStatusToChatItemStatus(message.status),
    ...createChatItemDefaults('message'),
    created_at: timestamp,
    updated_at: timestamp,
    revision: message.revision,
    sequence: message.sequence,
    session_id: message.session_id,
    message_id: message.id,
    ...(message.task_id ? { task_id: message.task_id } : {}),
    ...(message.operation_id ? { operation_id: message.operation_id } : {}),
    payload: {
      role: message.role,
      content: message.content,
      format: message.role === 'assistant' ? 'markdown' : 'text',
      ...(message.model_config_id
        ? { model_config_id: message.model_config_id }
        : {}),
      ...(message.reasoning_level
        ? { reasoning_level: message.reasoning_level }
        : {}),
    },
  };
}

function taskItems(task: ChatTaskSnapshotRef): ChatItem[] {
  const timestamp = task.updatedAt.getTime();
  const runtime: ChatItem = {
    schema_version: 1,
    id: chatItemIds.taskRuntime(task.taskId),
    type: 'runtime',
    status: taskStateToChatItemStatus(task.state),
    ...createChatItemDefaults('runtime'),
    created_at: timestamp,
    updated_at: timestamp,
    revision: task.revision,
    session_id: task.sessionId,
    task_id: task.taskId,
    operation_id: task.operationId,
    payload: {
      state: task.state,
      ...(task.errorMessage ? { detail: safeText(task.errorMessage) } : {}),
    },
  };
  if (!task.errorCode || !task.errorMessage) return [runtime];
  return [
    runtime,
    {
      schema_version: 1,
      id: `task:${task.taskId}:error`,
      type: 'error',
      status: task.state === 'cancelled' ? 'cancelled' : 'failed',
      ...createChatItemDefaults('error'),
      created_at: timestamp,
      updated_at: timestamp,
      revision: task.revision,
      session_id: task.sessionId,
      task_id: task.taskId,
      operation_id: task.operationId,
      payload: {
        code: task.errorCode,
        message: safeText(task.errorMessage),
        retryable: false,
      },
    },
  ];
}

function toolItem(view: SessionToolView): ChatItem {
  const approval = view.status === 'pending' && view.confirmation_id;
  const timestamp = Date.parse(view.expires_at ?? '') || 0;
  if (approval) {
    return {
      schema_version: 1,
      id: chatItemIds.approval(approval),
      type: 'approval',
      status: SESSION_TOOL_STATUS_TO_CHAT_ITEM_STATUS[view.status],
      ...createChatItemDefaults('approval'),
      created_at: timestamp,
      updated_at: timestamp,
      revision: view.version,
      session_id: view.session_id,
      tool_call_id: view.tool_call_id,
      approval_id: approval,
      ...(view.task_id ? { task_id: view.task_id } : {}),
      ...(view.operation_id ? { operation_id: view.operation_id } : {}),
      payload: {
        approval_id: approval,
        tool: view.tool_name,
        request_summary: view.request_summary,
        risk_level: view.risk_level,
        ...(view.expires_at ? { expires_at: Date.parse(view.expires_at) } : {}),
      },
    };
  }
  return {
    schema_version: 1,
    id: chatItemIds.tool(view.tool_call_id),
    type: 'tool',
    status: SESSION_TOOL_STATUS_TO_CHAT_ITEM_STATUS[view.status],
    ...createChatItemDefaults('tool'),
    created_at: timestamp,
    updated_at: timestamp,
    revision: view.version,
    session_id: view.session_id,
    tool_call_id: view.tool_call_id,
    ...(view.execution_id ? { execution_id: view.execution_id } : {}),
    ...(view.task_id ? { task_id: view.task_id } : {}),
    ...(view.operation_id ? { operation_id: view.operation_id } : {}),
    payload: {
      tool: view.tool_name,
      input_summary: view.request_summary,
      ...(view.result_summary ? { output_summary: view.result_summary } : {}),
      risk_level: view.risk_level,
      undo_available: view.allowed_actions.includes('undo'),
    },
  };
}

function previewItem(source: ChatPreviewSnapshotRef): ChatItem {
  const timestamp = source.createdAt.getTime();
  return {
    schema_version: 1,
    id: chatItemIds.preview(source.preview.preview_id),
    type: 'structured_preview',
    status: 'completed',
    ...createChatItemDefaults('structured_preview'),
    created_at: timestamp,
    updated_at: timestamp,
    revision: source.revision,
    task_id: source.taskId,
    operation_id: source.operationId,
    message_id: source.messageId,
    preview_id: source.preview.preview_id,
    session_id: source.sessionId,
    payload: source.preview,
  };
}

function safeText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key)-[a-z0-9_-]{8,}\b/gi, '[REDACTED]')
    .slice(0, 500);
}
