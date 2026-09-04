# 紫灵AI 前端

Expo 57 + React Native + TypeScript + Expo Router 移动端应用。

## 开发

```bash
# 仓库根目录
npm install
npm run build --workspace @partner-agent/contracts
npm run start --workspace @partner-agent/frontend
```

优先使用 Expo Go 验证。Web 可执行：

```bash
npm run web --workspace @partner-agent/frontend
```

复制 `.env.example` 为 `.env.local`，按运行环境调整 `EXPO_PUBLIC_SERVER_URL`：

- iOS 模拟器：`http://localhost:3000`
- Android 模拟器：`http://10.0.2.2:3000`
- Expo Go 真机：保持该变量为空，开发构建会优先从 `Constants.expoConfig.hostUri` 提取开发机地址并固定连接后端 `3000` 端口；旧版环境才回退 `expoGoConfig.debuggerHost`
- 真机显式配置：使用开发机局域网地址，例如 `http://192.168.1.20:3000`
- Web：未配置时开发环境回退 `http://localhost:3000`

显式配置始终优先；如果值不是有效的 `http`/`https` URL，应用会报告配置错误，不会悄悄改用 Expo Go 地址。生产构建不会读取 `hostUri`，必须提供 `EXPO_PUBLIC_SERVER_URL`。修改 `.env.local` 后清理 Metro 缓存并重启：

```bash
npm run start --workspace @partner-agent/frontend -- -c
```

`EXPO_PUBLIC_*` 会进入客户端包，不得放 API Key、数据库密码或其他秘密。

## 传输边界

页面和 feature 不直接调用 `fetch`、`socket.emit` 或后端 DTO：

- `src/api/http-client.ts`：REST 通用请求与错误归一化。
- `src/api/chat-api.ts`：`SubmitTextInput`、取消任务等 Command 适配。
- `src/api/agent-stream.ts`：Socket.IO 生命周期、会话过滤与流式事件订阅。
- `src/features/chat/use-chat.ts`：把领域动作与流式事件映射到 Zustand 状态。

前端通过 REST 提交 `SubmitTextInput` / `CancelTask`，通过 `/ws/v1` 订阅 task、operation 和 session 频道接收 `ServerPushEventV1`。新会话首次连接只订阅 `user:self`；REST 创建会话并返回权威引用后，再增量订阅 session/task/operation 并立即执行 REST 对账。断线后按频道携带水位续传；收到 `recovery_required` 时通过任务与会话 REST 查询恢复。HTTP 与 WS 共用 `setAccessTokenProvider` 注入的登录令牌，不把令牌写入 `EXPO_PUBLIC_*` 环境变量。

## 校验

```bash
npm run build --workspace @partner-agent/frontend
npm run lint --workspace @partner-agent/frontend
```
