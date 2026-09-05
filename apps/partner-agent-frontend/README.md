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
- Web：优先使用 `EXPO_PUBLIC_WEB_SERVER_URL`，其次使用通用地址，再尝试 Expo host 与开发平台回退；本地登录明确配置 `http://localhost:3000`，前端也使用 localhost，避免跨站 Cookie 失效

显式配置始终优先；如果值不是有效的 `http`/`https` URL，应用会报告配置错误，不会悄悄改用 Expo Go 地址。生产构建不会读取 `hostUri`，必须提供 `EXPO_PUBLIC_SERVER_URL`。修改 `.env.local` 后清理 Metro 缓存并重启：

```bash
npm run start --workspace @partner-agent/frontend -- -c
```

`EXPO_PUBLIC_*` 会进入客户端包，不得放 API Key、数据库密码或其他秘密。

## 传输边界

正式账户提供用户名密码注册、登录、刷新与退出；访问令牌仅在内存中，Native 刷新凭据按服务地址隔离保存在 SecureStore，Web 刷新凭据为 HttpOnly Cookie。退出撤销当前登录会话并清理聊天引用。旧 JWT 输入页面已移除，开发 CLI 仅用于工程验证；不自动迁移旧开发身份的会话。账户接口及验收边界见 [用户名密码登录闭环](../../docs/05-任务架构/2026-09-05-用户名密码登录闭环.md)。

页面和 feature 不直接调用 `fetch`、`socket.emit` 或后端 DTO：

- `src/api/http-client.ts`：REST 通用请求与错误归一化。
- `src/api/chat-api.ts`：`SubmitTextInput`、取消任务等 Command 适配。
- `src/api/agent-stream.ts`：Socket.IO 生命周期、会话过滤与流式事件订阅。
- `src/features/chat/use-chat.ts`：把领域动作与流式事件映射到 Zustand 状态。

前端通过 REST 提交 `SubmitTextInput` / `CancelTask`，通过 `/ws/v1` 订阅 task、operation 和 session 频道接收 `ServerPushEventV1`。新会话首次连接只订阅 `user:self`；REST 创建会话并返回权威引用后，再增量订阅 session/task/operation 并立即执行 REST 对账。断线后按频道携带水位续传；收到 `recovery_required` 时通过任务与会话 REST 查询恢复。HTTP 与 WS 共用 `setAccessTokenProvider` 注入的登录令牌，不把令牌写入 `EXPO_PUBLIC_*` 环境变量。

## 聊天会话连续性

助手顶部提供历史对话与新建入口；历史列表读取正式 `GET /api/v1/chat-sessions`，打开后通过会话详情及活动/最近任务引用恢复消息和回复状态。切换对话不会取消服务端任务。导航暂时只展示助手与设置。

选中会话 ID 按服务地址和用户隔离保存（Native 使用已有 SecureStore，Web 使用 localStorage）；不缓存消息正文或把登录令牌写入 localStorage。显式退出清除选中引用，重新登录仍可从历史列表打开服务端会话。未发送消息的新对话没有服务端资源，不提前订阅 session 频道。

重新打开、断线或返回前台时使用 REST 权威快照对账；会话切换以递增版本隔离旧 HTTP/WS 回调。当前消息保留仍是最近 100 条，不代表无限历史。

消息列表默认持续贴底，内容增长或可视高度变化不会关闭跟随。用户拖动、向上滚轮或键盘滚动时暂停；再次真正触底（仅允许 2px 舍入误差）或点击“回到最新消息”后恢复。发送消息不会强制改变用户当前的暂停状态；切换会话重新默认贴底。定位使用包含底部留白和页脚的实测内容高度，不使用估算的末条消息位置。

本批验证与真机待验收项见 [聊天会话连续性](../../docs/05-任务架构/2026-09-05-聊天会话连续性.md)。

键盘避让仅在 iOS 启用 `KeyboardAvoidingView` 的 padding；Android 使用系统 resize，避免重复计算高度。输入框聚焦只改变边框颜色，回到最新消息按钮悬浮于列表，已贴底时不重复发起滚动。Android Expo Go 聚焦稳定性仍需真机验收。

## 校验命令

```bash
npm run build --workspace @partner-agent/frontend
npm run lint --workspace @partner-agent/frontend
```
