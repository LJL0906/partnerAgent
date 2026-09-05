# 紫灵AI

紫灵AI 是一个面向个人长期信息管理、行动跟踪、目标管理和决策辅助的个人助手项目。

当前仓库同时保存产品需求、架构设计和产品自有代码。Monorepo、共享契约、持久会话、隐私外发决定闭环、外发审计、确认事务、正式 WS v1 和 Expo 首条聊天主链路已经落地；通用 Agent Runtime 又完成了持久任务 lease/fencing、工具审批恢复、模型可靠性与预算、PostgreSQL 事件重放、健康探针、CI 和容器基线。业务实现当前冻结在 P1-01 完成、P1-02 尚未开始的位置。

## 仓库边界

`partnerAgent` 是产品主仓库，负责维护：

- 需求、架构和技术决策文档；
- NestJS 业务后端；
- Expo / React Native 前端项目；
- 未来的 Python AI/RAG 项目；
- 数据库迁移、部署配置和项目级脚本；
- 前后端及 AI 服务之间的接口契约。

根目录可选的 `pi/` 是从官方仓库克隆的**本地参考项目**，用于 Agent 阅读、学习和源码分析，不属于本产品代码，也不会被提交到本仓库。根目录 `.gitignore` 已明确忽略 `/pi/`；本地是否存在该目录不影响产品构建与交付。

## 当前目录

```text
partnerAgent/
├── .git/                         # 产品主仓库
├── .gitignore                    # 主仓库统一忽略规则
├── package.json                  # npm workspaces 根配置
├── package-lock.json             # 根依赖锁
├── README.md                     # 项目入口说明
├── AGENTS.md                     # 协作与文档核对规则
├── docs/                         # 文档中心（详见 docs/README.md）
│   ├── 01-项目/                  # 项目边界、交接说明、P0 基线、阶段总结
│   ├── 02-需求/                  # 产品需求、技术架构与选型
│   ├── 03-技术草案/              # Local Core 路由/存储草案、Pi 分析
│   ├── 04-设计/                  # 前端设计参考图
│   └── 05-任务架构/              # 一次性任务架构与交付说明
├── apps/
│   ├── partner-agent-backend/    # NestJS 后端
│   └── partner-agent-frontend/   # Expo / React Native 前端
├── packages/
│   └── contracts/                # REST / WebSocket 共享契约
├── infra/                         # PostgreSQL、迁移任务与后端容器基线
├── services/                     # 未来 Python AI/RAG 服务
└── pi/                           # 可选本地 Pi 源码，仅供参考，不纳入 Git
```

未来项目继续放在当前 Workspace 边界内：

```text
├── services/partner-agent-ai/    # 未来 Python AI/RAG 服务
└── scripts/                      # 未来项目级脚本
```

## Pi 本地参考项目

如果本地另行克隆了 `pi/`，只在该目录中独立执行 Pi 项目的 Git 操作：

```bash
git -C pi status
git -C pi pull
```

不要在 `partnerAgent` 根目录通过 `git add -A` 将 `pi/` 纳入主仓库。不要把 Pi 源码复制到产品目录中作为产品代码提交。

## 当前能力

截至 2026 年 9 月 5 日：

- npm workspaces 和 NestJS 后端目录迁移已完成；
- 已建立 build/lint/unit/memory e2e 与 PostgreSQL 16 验迁/真实库测试两层 CI，并提供迁移先行的后端 Compose 基线；
- ChatTask 已由 PostgreSQL 权威认领，具备 lease/fencing、启动恢复、同 session 串行、通知唤醒与 polling 兜底；
- Agent Runtime 已限制 deadline、模型轮次、工具次数和 token 预算；模型网关仅在首响应前对瞬态错误有限重试，流开始后不重放；
- 正式 `/ws/v1` 已承载工具批准、拒绝和撤销，工具结果可持久恢复；WS 事件在 PostgreSQL 中保留最近 100 条/流并支持游标重放；
- P0 决策已收口为正式基线，`@partner-agent/contracts` 提供 REST Command/Query 与 WebSocket v1 共享契约；
- 使用 HS256 JWT 的 `sub` 识别可信用户；
- 正式用户名密码注册、登录、刷新和退出已接入；Web 使用 HttpOnly 刷新 Cookie，Native 使用 SecureStore。账户为第 16 条迁移，旧开发身份不自动合并；
- 会话列表、历史切换、续聊、重新打开恢复和消息贴底策略已实现并完成 Web 验证；Android Expo Go 键盘聚焦修复仍待真机验收；
- 支持按用户校验 `sessionId` 所有权、隔离限额、取消，以及带消息序号水位和完整工具上下文的会话恢复；
- 已接入无副作用的 `get_current_time` 工具；
- `/api/v1` 已登记 36 个 Command 和 38 个 Query，健康检查、会话列表/详情与任务查询、`SubmitTextInput`、`CancelTask`、`SubmitPrivacyDecision` 和 `SubmitConfirmationBatch` 已接通，其余 handler 显式返回 501；
- Local Core Entity/Migration 已加固，复用并扩展现有会话/消息表，候选 24 小时期限和高风险单候选由数据库约束；
- `/ws/v1` 已基于 PostgreSQL 权威数据授权 session/task/operation 频道，并支持顺序推送、已有水位的断线重放、LISTEN 重连主动 catch-up 和保留窗缺口的 REST 恢复提示；旧 Agent WS 已移出默认模块图，只允许开发环境显式启用兼容；
- ChatTask 生命周期和工具确认/拒绝/执行结果/撤销通知均已使用各自的 transactional outbox；relay 以稳定幂等键、lease/fence、同会话头阻塞和有限重试投递 WS stream；
- WS 事件按可配置 count/age 上限后台分批清理，stream position 永不因清理归零；
- 已提供低基数 Prometheus registry/exporter 与 owner-scoped Agent Run/Turn/Tool 元数据 trace，不保存模型正文、工具参数/结果或原始异常；
- `indeterminate` 外部工具操作可通过本机 CLI 执行固定结论的原子核对和脱敏审计，不重放工具、不恢复失败任务；毒性 outbox 事件另有仅限数据库运维权限使用的 `retry` / `discard` 处置命令和审计记录；
- Expo / React Native 前端只使用正式 v1 REST/WS 协议，支持订阅 ACK、事件去重、水位和 REST 恢复；
- Model Gateway 已建立递归结构扫描、递归脱敏与复扫、脱敏/等待/阻断策略、单次决定持久化及重启恢复闭环；无明文 PostgreSQL 审计已成为 Provider 调用前的可等待门槛，审计失败时以 `EGRESS_001` 阻止外发；
- `SubmitTextInput` 已显式校验 `request_analysis` / `analysis_types`；分析能力上线前，合法显式分析请求同步返回可幂等重放的 `NOT_IMPLEMENTED_001`，不创建消息、原始记录或 ChatTask；
- P1-01 已将 `action` 纳入权威 `ANALYSIS_TYPES`，冻结 Action DTO、`AnalysisTaskRef` 与 WS `candidate` 安全资源引用；`local-core.ts` 已拆分为 463 行，并新增 `local-core-analysis.ts`、`local-core-model.ts`、`local-core-queries.ts`；
- 已新增 `analysis_runs`、`structured_analyses` 实体与第 8 条 migration，具备 owner、OriginalRecord、ChatTask 复合所有权约束、状态约束和必要索引；
- `SubmitConfirmationBatch` 已按逐项决策、批次/候选/目标版本接通 PostgreSQL 原子事务；正式事实、目标、行动和长期记忆的其余 handler 仍需逐项接通，且只能经该事务生效；
- PostgreSQL 16 专用空库已完成现有 15 条 migration 全量 up → down → up；后端单元测试 58 个文件、323/323 通过，前端单元测试 13 个文件、87/87 通过，后端全量 e2e 15 个文件、131/131 通过；真实 DeepSeek、生产镜像构建及单实例 Compose 迁移、健康、重启和持久化冒烟均已通过。完整证据见 [`Agent 底座收口验证记录`](docs/05-任务架构/2026-09-05-Agent底座收口验证记录.md)。

## 后续启动顺序

当前技术底座的最终验证见 [`docs/05-任务架构/2026-09-05-Agent底座收口验证记录.md`](docs/05-任务架构/2026-09-05-Agent底座收口验证记录.md)；此前方案与分工保留在 [`2026-09-04-Agent技术底座加固.md`](docs/05-任务架构/2026-09-04-Agent技术底座加固.md) 作为实施记录。

恢复开发后，建议按以下顺序推进：

1. 用户已于 2026 年 9 月 5 日调整路线：优先完成日常聊天，原定 9 月 6 日进入 P1-02 的安排取消；P1-02 暂缓，未设恢复日期；
2. [聊天会话连续性](docs/05-任务架构/2026-09-05-聊天会话连续性.md) 和 [用户名密码登录闭环](docs/05-任务架构/2026-09-05-用户名密码登录闭环.md) 已实现，先完成 Android Expo Go 登录、键盘、滚动、会话恢复验收，再补齐草稿、失败处理等聊天功能；先保证功能完整，样式后续优化；
3. 聊天稳定后验证可校验、可追溯的结构化提案，再按需接正式业务确认和管理；正式对象仍只能通过确认事务生效；
4. 部署侧后续补 Prometheus 抓取/告警与备份恢复演练；不预先引入 Redis/BullMQ、LangGraph、pgvector 或 Python AI/RAG。

## 仓库拆分原则

本轮集成验证：build、lint 通过；contracts 12、后端 325、前端 112 项单元测试通过，共 449 项；memory e2e 121 项通过，真实 PostgreSQL 的 20 项本轮未运行。此前独立账户验收已完成 16 条迁移 up → down → up 及 8 项真实库账户测试，详见账户记录；不得把历史技术底座的 15 条迁移记录当作当前迁移数量。

当前不按语言或框架拆分仓库。只要前端、NestJS 和 Python 服务仍然共同服务于同一个产品、需要同步接口和需求，就继续使用本仓库。

只有在团队、权限、发布周期或部署边界真正独立后，才考虑拆分为多个仓库。
