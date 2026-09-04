# 紫灵AI 后端

本目录是紫灵AI的 NestJS 权威业务后端。它负责正式 `/api/v1` Command/Query、`/ws/v1` 流式与主动事件、持久 ChatTask 调度、隐私外发控制、工具审批，以及 PostgreSQL 数据与迁移。

## 架构边界

- PostgreSQL 是正式业务数据和任务状态的唯一真相源；`SESSION_STORE=memory` 仅用于测试和受控开发。
- Agent 和未来 RAG 能力只能生成回复或候选，不得绕过 Local Core 与确认事务直接写入正式业务对象。
- 模型请求必须经过隐私扫描、外发决定和审计；审计失败时禁止外发。
- 外部副作用工具使用独立审批、执行回执和撤销流程。ChatTask 生命周期与工具控制事件分别通过 transactional outbox 可靠投递。
- 旧 Agent WebSocket 默认禁用；产品客户端应只使用正式 `/api/v1` 与 `/ws/v1` 协议。

共享请求、响应和事件契约位于 `packages/contracts`。完整项目状态、技术决策和部署说明以仓库根 README、`docs/` 与 `infra/README.md` 为准。

## 安装与运行

在仓库根目录安装依赖：

```bash
npm ci
```

复制 `.env.example` 为本地 `.env`，至少配置有效的 `AUTH_JWT_SECRET` 和 `DATABASE_URL`。默认服务只监听 `127.0.0.1:3000`：

```bash
npm run migration:run --workspace @partner-agent/backend
npm run start:dev --workspace @partner-agent/backend
```

生产构建与启动：

```bash
npm run build --workspace @partner-agent/contracts
npm run build --workspace @partner-agent/backend
npm run migration:run:prod --workspace @partner-agent/backend
npm run start:prod --workspace @partner-agent/backend
```

数据库迁移必须先于新版本应用启动。容器化运行请使用 `infra/` 中的迁移先行方案。

## 本地设备接入

物理设备上的 Expo App 需要显式开放局域网监听，并将前端地址指向开发机的局域网 IP：

```dotenv
HOST=0.0.0.0
PORT=3000
CORS_ALLOWED_ORIGINS=http://localhost:8081,http://127.0.0.1:8081
```

`PORT` 必须是 1–65535 的整数。`CORS_ALLOWED_ORIGINS` 必须保持为精确来源白名单，不要使用 `*`。原生 Socket.IO 客户端可能不携带 `Origin`，但 REST 和 WS 都必须提供有效的 HS256 JWT。

可使用已有密钥生成短期本地开发令牌：

```bash
npm run dev:jwt --workspace @partner-agent/backend -- --subject local-device-user --expires-in 900
```

命令只输出令牌，不输出密钥。令牌与密钥都不得进入 Git、URL、日志、截图或聊天记录。

## 检查与测试

```bash
npm run build --workspace @partner-agent/backend
npm run lint --workspace @partner-agent/backend
npm run test --workspace @partner-agent/backend
npm run test:e2e --workspace @partner-agent/backend -- --exclude "test/real-postgres*.e2e-spec.ts"
```

真实 PostgreSQL 测试只应连接专用测试库。CI 会在 PostgreSQL 16 临时服务上执行迁移 up → down → up，并按工作流中的显式文件列表串行运行真实数据库用例。不要把开发库或生产库 URL 用作 `MIGRATION_VERIFY_DATABASE_URL` 或 `REAL_POSTGRES_DATABASE_URL`。

## 运维命令

列出与核对 `indeterminate` 外部工具操作：

```bash
npm run tool:reconcile --workspace @partner-agent/backend -- list --owner-id USER_ID
```

构建后列出耗尽重试的 ChatTask/工具控制 Outbox 事件：

```bash
npm run outbox:remediate --workspace @partner-agent/backend -- list
```

重试或丢弃毒事件需要命令输出提供的精确确认短语，并会在同一事务写入审计记录。执行前应先确认目标数据库、事件 ID、当前尝试次数和操作人标识。

## 健康检查

- `GET /health/live`：进程存活。
- `GET /health/ready`：数据库和应用就绪；优雅停机开始后返回非就绪。

进程内已维护低基数 Prometheus registry/exporter，但当前没有公开 HTTP `/metrics` 端点。业务健康 Query 仍通过 `/api/v1` 提供，具体路由以共享契约和控制器实现为准。
