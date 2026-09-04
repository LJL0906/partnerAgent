# 伙伴前端

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
- 真机：开发机局域网地址

`EXPO_PUBLIC_*` 会进入客户端包，不得放 API Key、数据库密码或其他秘密。

## 传输边界

页面和 feature 不直接调用 `fetch`、`socket.emit` 或后端 DTO：

- `src/api/http-client.ts`：REST 通用请求与错误归一化。
- `src/api/chat-api.ts`：`SubmitTextInput`、取消任务等 Command 适配。
- `src/api/agent-stream.ts`：Socket.IO 生命周期、会话过滤与流式事件订阅。
- `src/features/chat/use-chat.ts`：把领域动作与流式事件映射到 Zustand 状态。

正式方向是 REST 提交 Command、WebSocket 接收流。当前后端仍只有旧版 WS `chat/cancel/resume_session`，尚未实现这里默认使用的 `/api/v1` Command 路由，也尚未提供按 `operation_id` 的订阅协议；因此前端结构和失败态可运行，真实聊天闭环需后端完成对应端点后联调。

## 校验

```bash
npm run build --workspace @partner-agent/frontend
npm run lint --workspace @partner-agent/frontend
```
