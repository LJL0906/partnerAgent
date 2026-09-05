import { DataSource, In } from 'typeorm';
import { ChatTaskEntity } from '../database/entities/chat-task.entity.js';
import type { StoredChatTask } from './chat-task.store.js';

export async function memorySessionTaskRefs(
  values: Iterable<StoredChatTask>,
  ownerId: string,
  sessionId: string,
) {
  const tasks = [...values]
    .filter((task) => task.ownerId === ownerId && task.sessionId === sessionId)
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.taskId.localeCompare(b.taskId),
    );
  const active = tasks.find(
    (task) => !['completed', 'failed', 'cancelled'].includes(task.state),
  );
  const latest = tasks.at(-1);
  const ref = (task: StoredChatTask) => ({
    task_id: task.taskId,
    operation_id: task.operationId,
    state: task.state,
  });
  return {
    ...(active ? { active_task: ref(active) } : {}),
    ...(latest ? { latest_task: ref(latest) } : {}),
  };
}

export async function postgresSessionTaskRefs(
  dataSource: DataSource,
  ownerId: string,
  sessionId: string,
) {
  const repository = dataSource.getRepository(ChatTaskEntity);
  const select = { id: true, operationId: true, state: true } as const;
  const [active, latest] = await Promise.all([
    repository.findOne({
      where: {
        ownerId,
        sessionId,
        state: In([
          'queued',
          'running',
          'waiting_privacy_decision',
          'waiting_tool_approval',
        ]),
      },
      select,
      order: { createdAt: 'ASC', id: 'ASC' },
    }),
    repository.findOne({
      where: { ownerId, sessionId },
      select,
      order: { createdAt: 'DESC', id: 'DESC' },
    }),
  ]);
  const ref = (task: ChatTaskEntity) => ({
    task_id: task.id,
    operation_id: task.operationId,
    state: task.state,
  });
  return {
    ...(active ? { active_task: ref(active) } : {}),
    ...(latest ? { latest_task: ref(latest) } : {}),
  };
}
