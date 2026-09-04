# 本地容器运行

当前 Compose 只启动产品已有的 PostgreSQL、数据库迁移任务和 NestJS 后端。Python AI/RAG 尚未实现，因此这里不会创建占位服务。

## 启动前配置

从宿主环境提供以下变量，镜像内不包含密钥：

- `POSTGRES_PASSWORD`：PostgreSQL 用户 `partner_agent` 的密码；
- `DATABASE_URL`：容器网络内的连接串，主机名应为 `postgres`，例如 `postgresql://partner_agent:<URL 编码后的密码>@postgres:5432/partner_agent`；
- `AUTH_JWT_SECRET`：至少 32 字节的随机 JWT 密钥；
- `CORS_ALLOWED_ORIGINS`：逗号分隔的明确来源白名单，不允许 `*`；
- 所选模型对应的 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`。

可选变量包括 `BACKEND_PORT`、`DEFAULT_PROVIDER`、`DEFAULT_MODEL`，以及 `WS_EVENT_RETENTION_COUNT`、`WS_EVENT_RETENTION_AGE_MS`、`WS_EVENT_RETENTION_BATCH_SIZE`、`WS_EVENT_RETENTION_INTERVAL_MS` 四项事件保留配置。可以通过 shell 环境或本地未跟踪的 `.env` 提供这些值；不要提交真实凭据。生产 Compose 固定关闭旧 Agent WebSocket；生产配置若尝试启用也会在启动校验阶段被拒绝。

## 启动与检查

在仓库根目录运行：

```bash
docker compose -f infra/compose.yml up --build -d
```

Compose 会先等待 PostgreSQL 健康，再运行一次性 migration job；只有 migration 成功退出后，backend 才会启动。检查探针：

```bash
curl http://127.0.0.1:3000/health/live
curl http://127.0.0.1:3000/health/ready
```

`live` 只表示进程存活。`ready` 还要求服务未进入 draining、数据库可达且不存在待执行 migration；它不会探测模型 Provider。

停止服务但保留数据库卷：

```bash
docker compose -f infra/compose.yml down
```

迁移镜像运行编译后的迁移入口，不依赖 TypeScript 开发工具。生产部署应使用外部密钥管理和受控镜像标签，不应使用仓库内默认值替代凭据。
