import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { SessionToolView } from '@partner-agent/contracts';
import type { StoredSession } from '../database/session-store.js';
import { SessionStore } from '../database/session-store.js';
import { ToolOperationStore } from '../tools/tool-operation.store.js';
import { buildChatItemsSnapshot, type ChatPreviewSnapshotRef, type ChatTaskSnapshotRef } from './chat-item-adapter.js';
import { ChatTaskStore } from './chat-task.store.js';
import type { LocalCoreRequest } from './local-core-api.types.js';

export async function getChatSessionSnapshot(
  request: LocalCoreRequest,
  stores: {
    sessions: SessionStore;
    tasks: ChatTaskStore;
    tools?: ToolOperationStore;
  },
) {
  const sessionId = request.input.session_id;
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new HttpException(
      { code: 'VALIDATION_002', message: '缺少 session_id', details: { field: 'session_id' } },
      HttpStatus.BAD_REQUEST,
    );
  }
  const session = await stores.sessions.find(sessionId, request.userId);
  if (!session) {
    throw new NotFoundException({ code: 'AUTH_002', message: '会话不存在' });
  }
  const messages = await stores.tasks.listSessionMessages(request.userId, session.id);
  const taskRefs = await stores.tasks.getSessionTaskRefs(request.userId, session.id);
  const taskIds = [...new Set(
    [taskRefs.active_task?.task_id, taskRefs.latest_task?.task_id].filter(
      (taskId): taskId is string => Boolean(taskId),
    ),
  )];
  const tasks = (await Promise.all(
    taskIds.map((taskId) => stores.tasks.getTask(request.userId, taskId)),
  )).filter((task): task is NonNullable<typeof task> => Boolean(task));
  const taskSnapshots: ChatTaskSnapshotRef[] = tasks.map((task) => ({
    taskId: task.taskId, sessionId: task.sessionId, operationId: task.operationId,
    state: task.state, revision: task.revision,
    updatedAt: task.updatedAt,
    ...(task.errorCode ? { errorCode: task.errorCode } : {}),
    ...(task.errorMessage ? { errorMessage: task.errorMessage } : {}),
  }));
  const toolViews: SessionToolView[] = stores.tools
    ? await stores.tools.listSessionToolViews(request.userId, session.id)
    : [];
  const storedPreviews = await stores.tasks.listSessionChatPreviews(
    request.userId,
    session.id,
  );
  const previews: ChatPreviewSnapshotRef[] = storedPreviews.map((stored) => ({
    preview: stored.preview, sessionId: stored.session_id, taskId: stored.task_id,
    operationId: stored.operation_id, messageId: stored.message_id,
    revision: stored.message_revision,
    createdAt: new Date(
      messages.find((message) => message.id === stored.message_id)?.created_at ??
        session.lastActiveAt,
    ),
  }));
  return {
    ...(await buildSessionSummary(session, request.userId, stores.tasks)),
    message_count: messages.length,
    messages,
    tool_views: toolViews,
    items: buildChatItemsSnapshot({ messages, tasks: taskSnapshots, toolViews, previews }),
  };
}

export async function buildSessionSummary(
  session: StoredSession,
  ownerId: string,
  tasks: ChatTaskStore,
) {
  const title = session.messages.find((message) => message.role === 'user')?.content;
  const preview = session.messages.at(-1)?.content;
  const compact = (text: string, length: number) =>
    text.replace(/\s+/g, ' ').trim().slice(0, length);
  return {
    id: session.id,
    title: session.title ?? (title ? compact(title, 48) : '新对话'),
    created_at: session.createdAt.toISOString(),
    updated_at: session.lastActiveAt.toISOString(),
    message_count: session.messages.length,
    ...(preview ? { last_message_preview: compact(preview, 120) } : {}),
    ...(await tasks.getSessionTaskRefs(ownerId, session.id)),
  };
}
