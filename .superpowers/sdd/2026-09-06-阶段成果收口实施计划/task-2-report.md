# Task 2 实施报告：预览存储不变量与恢复校验

## 结果

- `completeAssistantOutput` 的 memory 与 TypeORM 写入边界现在统一只接受 `chat + 0 previews` 或 `structured_preview/action + >=1 valid preview`。
- 非法组合统一返回 `{ outcome: 'invalid_output' }` 及固定安全错误码；runner 通过 lease fence 将任务标为 failed，不写入 assistant message、context、完成态或 completed outbox。revision conflict 与 fence rejection 仍保留原语义。
- memory 与 TypeORM 回读边界统一使用 contracts `recoverChatPreviewsV1`：损坏项被隔离，重复 ID 按持久化顺序保留第一项，超过 20 项或使累计载荷超过 64 KiB 的候选被跳过，后续较小合法 sibling 仍可恢复。最终非空集合可通过严格 `parseChatPreviewsV1`，且会话内无重复 preview ChatItem ID。
- 真实库成功 fixture 已修正为 `structured_preview/action` 任务，并增加合法 sibling 与损坏 preview 混合时只恢复合法项的反例。

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
- 恢复采取两种 store 一致的 attachment isolation：仅跳过不能加入严格集合的损坏/重复/超限候选，按稳定顺序保留其他合法卡，不返回伪成功卡。
- 已复审根 README、backend README 与 Task 2 brief；实现与 PostgreSQL 权威存储、共享契约 parser 不变量一致，未发现文档偏离。

## Commit

本报告与 Task 2 实现由同一最终提交承载，提交哈希见 Task 2 最终交付回报。

## Fix round 1（2026-09-06）

### 审查结果与修正

- 将完成边界的预览不变量失败从普通 `conflict` 拆分为显式 `invalid_output`，并仅携带固定安全错误码/消息：结构化任务缺附件为 `STRUCTURED_PREVIEW_MISSING`，其他模式或契约错误为 `STRUCTURED_PREVIEW_INVALID`。
- `ChatTaskRunner` 只对 `invalid_output` 调用带 lease fence 的 `markFailed`，落明确 failed 终态并发布安全状态；普通 revision `conflict` 与 lease `fence_rejected` 仍按原 fencing 语义直接停止，未被误判成任务失败。
- 修正 `chat-task.store.spec.ts` 的附件成功 fixture，显式使用 `structured_preview/action`。
- 回读改为共享容错 helper 逐项校验：损坏附件被隔离，同消息/会话的其他合法卡继续恢复。当前未引入新的 logger 构造依赖，因此这是 fail-closed attachment isolation：损坏对象不会静默伪装成成功卡，但本轮不额外记录诊断日志。
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

## 最终验收 Important #2/#4 修正（2026-09-06）

### 策略

- contracts 新增 `recoverChatPreviewsV1`，专用于持久化 JSONB 回读；`parseChatPreviewsV1` 的严格写入拒绝语义未改变。
- 恢复 helper 按原数组顺序处理。每个候选先经 `parseChatPreviewV1`，再用 `parseChatPreviewsV1([...recovered, candidate])` 复用集合级唯一性、数量和 UTF-8 JSON 载荷限制。不可加入的候选被隔离，继续尝试后续项；因此重复 ID 确定保留第一项，前 20 个可接受项稳定保留，导致累计超 64 KiB 的大项被跳过后，后续较小合法项仍可保留。
- memory/TypeORM 都直接使用该 contracts helper，并在会话聚合层按消息 sequence 对 `preview_id` 再做稳定 first-wins，防止跨消息重复 ChatItem ID。

### RED / GREEN 证据

- RED：Memory/TypeORM 定向用例同时显示重复 ID 被全部返回、22 项全部返回、使累计载荷超 64 KiB 的第三个大附件仍被返回，且恢复结果无法通过严格集合 parser。contracts 回归在 helper 未实现时以 `recoverChatPreviewsV1 is not a function` 失败。
- GREEN：contracts 全量 4 suites / 140 tests passed；Memory+TypeORM 定向 2 files / 15 tests passed；backend 全量 78 files / 453 tests passed；memory e2e 8 files / 132 tests passed；backend build/lint 通过。
- 测试显式校验恢复顺序、first-wins、20 项上限、累计 64 KiB 隔离后继续、损坏 sibling 隔离、最终严格集合 parser 通过，以及 `chatItemIds.preview` 无重复。

### 本轮文件

修改：

- `packages/contracts/src/chat-preview.ts`
- `packages/contracts/test/contract-alignment-v1.test.cjs`
- `apps/partner-agent-backend/src/local-core-api/chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/memory-chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/typeorm-chat-task.store.ts`
- `apps/partner-agent-backend/src/local-core-api/chat-task-runner-output.spec.ts`
- `apps/partner-agent-backend/src/local-core-api/typeorm-chat-output.store.spec.ts`
- `.superpowers/sdd/2026-09-06-阶段成果收口实施计划/task-2-report.md`

新增：无。删除：无。未修改 A10、session store、heartbeat 或 docs 收口文件。
