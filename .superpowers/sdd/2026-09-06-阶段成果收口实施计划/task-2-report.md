# Task 2 实施报告：预览存储不变量与恢复校验

## 结果

- `completeAssistantOutput` 的 memory 与 TypeORM 写入边界现在统一只接受 `chat + 0 previews` 或 `structured_preview/action + >=1 valid preview`。
- 非法组合统一返回 `{ outcome: 'conflict' }`，不写入 assistant message、context、task 完成态或 outbox；解析失败也转为同样的安全非 committed 结果。
- memory 与 TypeORM 回读边界现在逐项调用 `parseChatPreviewV1`。任一附件损坏时整次恢复显式失败，不返回部分成功卡，也不对未校验 JSONB 做类型强转。
- 真实库成功 fixture 已修正为 `structured_preview/action` 任务，并增加“正常恢复后注入单个损坏 preview”的反例。

## RED

命令：

```text
npm run test --workspace @partner-agent/backend -- src/local-core-api/typeorm-chat-output.store.spec.ts src/local-core-api/chat-task-runner-output.spec.ts
```

结果：2 个测试文件中 6 个新回归断言按预期失败：`chat + preview` 与 `structured_preview + 0 preview` 均被旧实现错误提交，memory/TypeORM 的损坏 metadata 均被旧实现直接作为成功预览返回。

## GREEN 与验证

- 定向单测：2 files passed，12 tests passed。
- Backend build：`npm run build --workspace @partner-agent/backend` 通过。
- Backend lint：`npm run lint --workspace @partner-agent/backend` 通过。
- 真实库定向命令：`npm run test:e2e --workspace @partner-agent/backend -- test/real-postgres-data-recovery.e2e-spec.ts`。测试文件成功加载，当前环境未提供专用 `REAL_POSTGRES_DATABASE_URL`，因此 1 suite / 1 test 按约定 skipped，未宣称真实 PostgreSQL 执行通过。
- `git diff --check` 通过；仅有 Git 对现有 Windows 换行策略的 LF/CRLF 提示，无空白错误。

## 文件清单

新增（基线 Git 视角）：

- `apps/partner-agent-backend/test/real-postgres-data-recovery.e2e-spec.ts`（保留并修正工作区已有未跟踪 fixture）
- `.superpowers/sdd/2026-09-06-阶段成果收口实施计划/task-2-report.md`

修改：

- `apps/partner-agent-backend/src/local-core-api/chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/memory-chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/typeorm-chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/typeorm-chat-output.store.spec.ts`
- `apps/partner-agent-backend/src/local-core-api/chat-task-runner-output.spec.ts`

删除：无。

## 自审

- 修改仅限 brief 指定的存储、测试文件与本报告，未覆盖其他未提交成果。
- 非法完成组合在任何权威写入前被拒绝；TypeORM 仍在原事务中执行，memory 在第一次 session/message 变更前返回。
- 恢复采取两种 store 一致的 fail-closed 行为：损坏项抛出共享契约校验错误，不吞掉错误、不返回其他部分卡片。
- 已复审根 README、backend README 与 Task 2 brief；实现与 PostgreSQL 权威存储、共享契约 parser 不变量一致，未发现文档偏离。

## Commit

本报告与 Task 2 实现由同一最终提交承载，提交哈希见 Task 2 最终交付回报。

## Fix round 1（2026-09-06）

### 审查结果与修正

- 将完成边界的预览不变量失败从普通 `conflict` 拆分为显式 `invalid_output`，并仅携带固定安全错误码/消息：结构化任务缺附件为 `STRUCTURED_PREVIEW_MISSING`，其他模式或契约错误为 `STRUCTURED_PREVIEW_INVALID`。
- `ChatTaskRunner` 只对 `invalid_output` 调用带 lease fence 的 `markFailed`，落明确 failed 终态并发布安全状态；普通 revision `conflict` 与 lease `fence_rejected` 仍按原 fencing 语义直接停止，未被误判成任务失败。
- 修正 `chat-task.store.spec.ts` 的附件成功 fixture，显式使用 `structured_preview/action`。
- 回读改为共享 `parseStoredChatPreviews` 逐项校验：损坏附件被隔离，同消息/会话的其他合法卡继续恢复。当前未引入新的 logger 构造依赖，因此这是 fail-closed attachment isolation：损坏对象不会静默伪装成成功卡，但本轮不额外记录诊断日志。
- 真实 PostgreSQL fixture 仍为 `structured_preview/action`，合法+损坏混合 JSONB 反例现在断言只恢复合法 preview。

### RED / GREEN

- RED：三个定向文件共 8 个新/修正断言失败；失败原因分别为 store 仍返回 `conflict`、runner 遗留 `running`、损坏 sibling 导致整次恢复抛错。
- GREEN：`chat-task.store.spec.ts`、`chat-task-runner-output.spec.ts`、`typeorm-chat-output.store.spec.ts` 共 3 files / 28 tests passed。
- Backend build 与 lint 均通过。
- 真实库定向文件成功加载；当前环境仍未提供专用 `REAL_POSTGRES_DATABASE_URL`，因此 1 suite / 1 test skipped，留给 Task 4 的真库环境执行。

### Fix round 1 文件清单

修改：

- `apps/partner-agent-backend/src/local-core-api/chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/memory-chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/typeorm-chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/chat-task-runner.ts`
- `apps/partner-agent-backend/src/local-core-api/chat-task.store.spec.ts`
- `apps/partner-agent-backend/src/local-core-api/chat-task-runner-output.spec.ts`
- `apps/partner-agent-backend/src/local-core-api/typeorm-chat-output.store.spec.ts`
- `apps/partner-agent-backend/test/real-postgres-data-recovery.e2e-spec.ts`
- `.superpowers/sdd/2026-09-06-阶段成果收口实施计划/task-2-report.md`

新增：无。删除：无。Task 3 revision 相关文件未触碰。

Fix round 1 使用新提交承载，提交哈希见本轮最终交付回报。
