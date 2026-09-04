# Local Core REST 路由与 WebSocket 订阅草案

> 状态：v1 路由与订阅实现基线（2026-09-04）。  
> 契约依据：`packages/contracts/src/local-core.ts`。

## 1. 统一约定

- REST 前缀：`/api/v1`；WS endpoint：`/ws/v1`。
- Command 用 `POST`，body 保持 `CommandEnvelope<Payload>`；Query 用 `GET`，复杂只读检索可用 `POST` 并明确无副作用。
- JSON 字段沿用契约的 `snake_case`。用户身份只取 JWT `sub`，不信任 body/query 中的 `user_id`。
- `completed` / 同载荷 `duplicate` 返回 200，`accepted` 返回 202；幂等同 ID 异载荷、版本冲突返回 409。
- 列表 Query 统一使用 `cursor` / `limit` / `sort[field]` / `sort[order]` / `filter[...]`；`limit` 建议默认 20、上限 100。
- 后台任务与 WS 连接解耦；断线不取消任务。

## 2. Command 路由映射

| 路由 | Command payload | 备注 |
|---|---|---|
| `POST /api/v1/inputs/text` | `SubmitTextInputPayload` | 返回会话、消息和任务引用 |
| `POST /api/v1/inputs/voice` | `SubmitVoiceInputPayload` | 仅接收用户确认后的转写 |
| `POST /api/v1/voice-drafts/upsert` | `CreateOrUpdateVoiceDraftPayload` | 临时数据 |
| `POST /api/v1/voice-drafts/cancel` | `CancelVoiceDraftPayload` | 不产生正式副作用 |
| `POST /api/v1/attachments/submit` | `SubmitAttachmentInputPayload` | 上传后的附件引用 |
| `POST /api/v1/analysis-runs/cancel` | `CancelAnalysisPayload` | 不删除原始记录 |
| `POST /api/v1/tasks/cancel` | `CancelTaskPayload` | 取消仍可取消的后台任务 |
| `POST /api/v1/original-records/reanalyze` | `RequestReanalysisPayload` | 生成新运行/版本 |
| `POST /api/v1/attachments/supplement-analysis` | `RequestAttachmentSupplementAnalysisPayload` | 不覆盖原分析 |
| `POST /api/v1/model-configs/upsert` | `UpsertModelConfigPayload` | API Key 仅入安全存储 |
| `POST /api/v1/model-configs/delete` | `DeleteModelConfigPayload` | 设置操作 |
| `POST /api/v1/model-configs/reorder` | `ReorderModelConfigsPayload` | 设置操作 |
| `POST /api/v1/model-configs/set-default` | `SetDefaultModelPayload` | 设置操作 |
| `POST /api/v1/messages/set-model-selection` | `SetMessageModelSelectionPayload` | 仅影响当前消息 |
| `POST /api/v1/model-connections/test` | `TestModelConnectionPayload` | 不发送个人数据 |
| `POST /api/v1/model-tasks/start` | `StartBusinessModelTaskPayload` | 长任务返回 `task_refs` |
| `POST /api/v1/privacy-decisions/submit` | `SubmitPrivacyDecisionPayload` | 外发决策，非业务确认 |
| `POST /api/v1/suggestions/feedback` | `RecordSuggestionFeedbackPayload` | 不自动创建行动 |
| `POST /api/v1/confirmation-batches/submit` | `SubmitConfirmationBatchPayload` | 正式对象唯一生效入口 |
| `POST /api/v1/reminder-instances/close` | `CloseReminderInstancePayload` | 不改行动状态 |
| `POST /api/v1/reminder-instances/snooze` | `SnoozeReminderInstancePayload` | 不改行动状态 |
| `POST /api/v1/reminder-plans/update` | `UpdateReminderPlanPayload` | 涉及业务字段时先产候选 |
| `POST /api/v1/reminder-candidates/create` | `CreateReminderActionCandidatePayload` | 仅生成候选 |
| `POST /api/v1/notification-results/register` | `RegisterNotificationResultPayload` | 投递记录 |
| `POST /api/v1/export-previews/create` | `PreviewExportPayload` | 只读计算，可生成 `preview_token` |
| `POST /api/v1/exports/start` | `StartExportPayload` | 需导出确认 |
| `POST /api/v1/exports/cancel` | `CancelExportPayload` | 不改源对象 |
| `POST /api/v1/exports/retry` | `RetryExportPayload` | 不得扩大范围 |
| `POST /api/v1/exports/download-result` | `DownloadExportResultPayload` | 仅成功交付物 |
| `POST /api/v1/indexes/rebuild` | `RebuildIndexPayload` | 不改业务对象 |
| `POST /api/v1/context-snapshots/refresh` | `RefreshContextSnapshotPayload` | 只生成视图或候选 |
| `POST /api/v1/facts/mark-incorrect` | `MarkFactIncorrectPayload` | 按 Fact 规则决定是否产候选 |

### 2.1 不直接公开的维护 Command

归档、软删除、恢复和彻底删除契约已收口为“生成候选”；下列路由不得直接改库，最终只能由 `POST /api/v1/confirmation-batches/submit` 生效。

| 预留路由 | 现有 payload | v1 对外语义 |
|---|---|---|
| `POST /api/v1/object-change-candidates/archive` | `CreateArchiveObjectCandidatePayload` | 生成归档候选 |
| `POST /api/v1/object-change-candidates/soft-delete` | `CreateSoftDeleteObjectCandidatePayload` | 生成软删除候选 |
| `POST /api/v1/object-change-candidates/restore` | `CreateRestoreObjectCandidatePayload` | 生成恢复候选 |
| `POST /api/v1/object-change-candidates/permanently-delete` | `CreatePermanentDeleteObjectCandidatePayload` | 生成二次确认候选；本路由不执行物理删除 |

## 3. Query 路由映射

| 路由 | Query |
|---|---|
| `GET /api/v1/chat-sessions/:sessionId` | `GetChatSessionQuery` |
| `GET /api/v1/original-records/:recordId` | `GetOriginalRecordQuery` |
| `GET /api/v1/attachments/:attachmentId/status` | `GetAttachmentStatusQuery` |
| `GET /api/v1/analysis-runs/:analysisRunId` | `GetAnalysisRunQuery` |
| `GET /api/v1/tasks/:taskId` | `GetTaskStatusQuery` |
| `GET /api/v1/core/health` | `GetCoreHealthQuery` |
| `GET /api/v1/confirmation-batches?status=pending` | `ListPendingConfirmationBatchesQuery` |
| `GET /api/v1/confirmation-batches/:batchId` | `GetConfirmationBatchQuery` |
| `GET /api/v1/candidates/:candidateId` | `GetCandidateDetailQuery` |
| `GET /api/v1/confirmation-history` | `GetConfirmationHistoryQuery` |
| `GET /api/v1/objects/:kind/:objectId/undo-eligibility` | `GetUndoEligibilityQuery` |
| `GET /api/v1/goals` | `ListGoalsQuery` |
| `GET /api/v1/goals/:goalId` | `GetGoalQuery` |
| `GET /api/v1/actions` | `ListActionsQuery` |
| `GET /api/v1/actions/:actionId` | `GetActionQuery` |
| `GET /api/v1/facts` | `ListFactsQuery` |
| `GET /api/v1/facts/:factId` | `GetFactQuery` |
| `GET /api/v1/memories` | `ListMemoriesQuery` |
| `GET /api/v1/memories/:memoryId` | `GetMemoryQuery` |
| `GET /api/v1/decisions` | `ListDecisionsQuery` |
| `GET /api/v1/decisions/:decisionId` | `GetDecisionQuery` |
| `GET /api/v1/context-snapshot` | `GetContextSnapshotQuery` |
| `GET /api/v1/objects/:kind/:objectId/history` | `GetChangeHistoryQuery` |
| `POST /api/v1/relevant-context/search` | `SearchRelevantContextQuery` |
| `GET /api/v1/suggestions/:suggestionId/evidence` | `GetSuggestionEvidenceQuery` |
| `GET /api/v1/indexes/health` | `GetIndexHealthQuery` |
| `GET /api/v1/indexes/rebuild-status` | `GetIndexRebuildStatusQuery` |
| `GET /api/v1/summaries/daily` | `GetDailySummaryQuery` |
| `GET /api/v1/reviews/weekly` | `GetWeeklyReviewQuery` |
| `GET /api/v1/reminders` | `ListRemindersQuery` |
| `GET /api/v1/reminder-instances/:reminderInstanceId` | `GetReminderInstanceQuery` |
| `GET /api/v1/reminder-candidates?status=pending` | `ListPendingReminderCandidatesQuery` |
| `GET /api/v1/model-configs` | `ListModelConfigsQuery` |
| `GET /api/v1/model-runtime/status` | `GetModelRuntimeStatusQuery` |
| `GET /api/v1/privacy-policy/status` | `GetPrivacyPolicyStatusQuery` |
| `GET /api/v1/export-preview?preview_token=...` | `GetExportPreviewQuery` |
| `GET /api/v1/export-preview?export_task_id=...` | `GetExportPreviewQuery` |
| `GET /api/v1/exports/:exportTaskId` | `GetExportTaskQuery` |

`GetExportPreviewQuery` 的两个查询参数互斥。`SearchRelevantContextQuery` 用 POST 是为了避免复杂/敏感检索内容进入 URL；其语义仍为只读。

## 4. WebSocket 订阅规范

### 4.1 连接与频道

- 握手使用与 REST 相同的 JWT。每次订阅都重新校验会话/任务/操作所有权。
- 客户端只发送订阅控制事件，不通过 WS 提交业务 Command。
- 保留单一服务端推送事件名 `agent_event`。

| 频道 | 用途 | 允许的典型事件 |
|---|---|---|
| `task:{task_id}` | 单个聊天响应、分析、解析、导出任务 | `text_delta`, `tool_start`, `tool_end`, `done`, `error` |
| `operation:{operation_id}` | 一次 Command 派生的多任务/资源 | 任务事件、`candidate`, `done`, `error` |
| `session:{session_id}` | 会话级推送 | `candidate`, `summary` |
| `user:self` | 当前用户主动推送 | `candidate`, `reminder`, `summary` |

客户端不得订阅任意 `user:{id}`，用户级频道只允许 `user:self`。

### 4.2 订阅控制

```ts
interface SubscribeRequest {
  request_id: string;
  channels: string[];
  after?: Record<string, string>; // channel -> last event_id
}

interface SubscriptionAck {
  request_id: string;
  accepted: string[];
  rejected: Array<{ channel: string; code: string; message: string }>;
}
```

控制事件建议为 `subscribe`、`unsubscribe`、`subscription_ack`、`ping`、`pong`。未知或越权频道必须在 ACK 中显式拒绝。

### 4.3 事件信封

`local-core.ts` 的 `ServerPushEvent` 建议在基线前补齐：

```ts
interface ServerPushEventV1 extends ServerPushEvent {
  schema_version: 1;
  event_id: string;
  sequence: number;
  task_id?: string;
}
```

- 交付语义为“至少一次”；单频道内按 `sequence` 有序，不保证跨频道全局有序。
- 同一事件可投递至多个已订阅频道，客户端按 `event_id` 去重。
- 重连时带 `after`。若 token 事件已不可重放，服务端发恢复提示，客户端通过 `GET /tasks/:taskId` 和 `GET /chat-sessions/:sessionId` 补最终状态。
- `data` 禁止携带 API Key、未脱敏的外发内容、服务端内部路径或错误栈。

## 5. 契约收口结果

1. `CancelTaskPayload` 已补齐，并映射 `POST /api/v1/tasks/cancel`。
2. 旧 WS `chat/cancel/resume_session` 仅作弃用兼容契约；v1 业务 Command/Query 走 REST。
3. v1 推送使用 `ServerPushEventV1`，统一 `snake_case` 和 `event_type`；旧 `AgentEvent` 已标记 deprecated。
4. 归档/删除/恢复类 Command 已统一为 `Create*CandidatePayload`，不提供正式对象旁路写入。
5. 路由已全部登记；尚未接通的业务 handler 显式返回 `501 NOT_IMPLEMENTED_001`，不伪造成功。
