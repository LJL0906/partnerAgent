# 紫灵AI 前端

Expo 57 + React Native + TypeScript + Expo Router 移动端应用。

## 开发

```bash
# 仓库根目录
npm install
npm run build --workspace @partner-agent/contracts
npm run start --workspace @partner-agent/frontend
```

Android/iOS 开发统一使用 Expo Go；完整聊天消息渲染不依赖自定义原生模块。
Web 可执行：

```bash
npm run web --workspace @partner-agent/frontend
```

本地联调测试账户记录在[开发交接说明](../../docs/01-项目/开发交接说明.md)中；浏览器或真机验收前直接按该文档登录，不要另外创建临时账号。该账户仅限开发/测试环境。

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

Windows 下 Metro 使用项目内 `metro.config.js` 排除前端不消费的后端 workspace 监听，并将 transform worker 限为 2，避免后端构建产生无关 HMR 风暴或首次打包耗尽文件句柄。该配置仍监听 contracts，不改变 workspace root 或模块解析；排障时不要用禁用 monorepo root 的环境变量替代，否则 Web SSR 可能生成错误的 `/node_modules` bundle 地址。

## 传输边界

正式account提供用户名密码注册、登录、刷新与退出；访问令牌仅在内存中，Native refresh-credential按服务地址隔离保存在 SecureStore，Web refresh-credential为 HttpOnly Cookie。退出撤销当前登录会话并清理聊天引用。旧 JWT 输入页面已移除，开发 CLI 仅用于工程验证；不自动迁移旧开发身份的会话。account-controller及验收边界见 [用户名密码登录闭环](../../docs/05-任务架构/2026-09-05-用户名密码登录闭环.md)。

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

聊天输入框不提供“行动预览”手动开关。所有消息按普通聊天提交，由 Agent 根据明确行动意图决定是否生成预览；普通问答不生成，意图不明确时先追问。按下发送后输入草稿立即清空；若提交未被接受且用户尚未输入新内容，原草稿自动恢复。助手消息默认按中国标准时间理解和展示，只使用中文日期、星期与时段，界面不展示 `Asia/Shanghai`、UTC、GMT、RFC 3339 或 AM/PM 等内部时间格式。行动结构化结果以会话快照中的 `structured_preview` 附件展示：卡片仅保留标题、有效摘要、格式化时间和必要确认信息，并固定标记“待确认 · 尚未生效”；同一任务存在正式候选时不再逐条展示候选卡，而是按批次合并为一个单选浮层。恢复或切换历史会话时浮层默认收起，仅保留时间线入口供用户主动打开；浮层支持自动或手动前后翻页，最后一项选择即自动汇总为最终授权交给 Agent 执行，不再要求二次提交或确认；收起浮层不会删除候选。

输入区空闲时以加号提供微信式“更多”面板，当前展示图片、拍摄和文件三个占位入口；输入正文后加号原位切换为发送按钮，实际媒体选择与上传能力后续接入。
输入框左侧提供声波/键盘双态图标；切换后进入“实时语音通话 · 即将开放”占位区域，产品语义是用户与模型像打电话一样双向实时交流，而非语音转文字。切回文字聊天时保留原草稿；当前不申请麦克风权限，也不执行录音或语音传输。

助手消息按契约中的 `markdown` 格式使用纯 JavaScript 渲染标题、段落、强调、列表、引用、代码、表格、链接和媒体，不依赖 Expo Go 之外的自定义原生视图。只有独立的 Markdown 围栏块和代码块显示纯图标复制操作，普通消息正文不显示整条复制按钮。安全的 HTTP(S) 图片、视频、音频直链以及 `<img>` / `<video>` / `<audio>` 结果会直接展示；图片和视频缩略图自身即为预览入口，不额外显示“放大”按钮，点击后通过 React Native 全屏弹层预览，视频使用 Expo Go 支持的 `expo-video` 播放，音频使用 `expo-audio` 播放。其他文件 URL 保持安全可点击链接。用户的 `text` 消息保持纯文本语义。模型提供的思考增量使用独立的“思考过程”区域展示，并随助手消息写入消息元数据；REST 快照、刷新和会话切换后可按任务恢复、展开和追溯。

结构化预览、候选入口、思考过程、工具状态和审批均按消息 `sequence` 留在聊天时间线原位，不再固定堆叠在输入框上方。一个候选批次只保留一个选择入口，批次内候选作为单选项进入同一浮层，避免重复卡片。复杂任务可通过内部 `update_task_todo` 工具维护 2–8 项临时待办；标题栏仅在存在未完成待办时显示清单图标，点击打开浮层查看进度。全量待办完成或任务进入完成、取消、失败终态时会自动清空并隐藏入口；简单问答不创建待办，待办也不写入正式 Action 数据。

聊天页不再显示右下角可拖拽导航按钮。星光导航入口固定在标题栏“新建对话”右侧，使用 36px 紧凑按钮并与同组操作水平居中；菜单浮层直接贴合按钮下沿，不再叠加安全区或额外间距。其他页面暂时保留原悬浮导航入口。

消息列表默认持续贴底，内容增长或可视高度变化不会关闭跟随。用户拖动、向上滚轮或键盘滚动时暂停；再次真正触底（仅允许 2px 舍入误差）或点击“回到最新消息”后恢复。发送消息不会强制改变用户当前的暂停状态；切换会话重新默认贴底。定位使用包含底部留白和页脚的实测内容高度，不使用估算的末条消息位置。

会话包含至少两个用户问题时，消息区左侧显示固定小间距的紧凑问题锚点轨道，目录按钮固定在左下方拇指热区，轨道收拢排列在按钮上方；轨道保留 44px 隐形触控宽度，点击可直接跳转，长按后上下滑动时仅更新带独立序号列和两行标题的响应式问题预览，并通过滞回区过滤手指抖动，手指越出轨道时冻结最后一个有效预览，松手后才执行一次最终跳转。点击目录按钮会向右上方展开紧贴按钮的窄浮层。浮层最多占用约半屏高度、问题摘要限制为两行；长会话会压缩轨道刻度但保留首尾和当前问题，拖动仍覆盖全部问题，完整目录也可滚动查看。跳转到历史问题后暂停自动贴底，避免新消息立即打断阅读。

本批验证与真机待验收项见 [聊天会话连续性](../../docs/05-任务架构/2026-09-05-聊天会话连续性.md)。

键盘避让仅在 iOS 启用 `KeyboardAvoidingView` 的 padding；Android 使用系统 resize，避免重复计算高度。输入框聚焦只改变边框颜色，回到最新消息按钮悬浮于列表，已贴底时不重复发起滚动。Android Expo Go 聚焦稳定性仍需真机验收。

## 校验命令

```bash
npm run build --workspace @partner-agent/frontend
npm run lint --workspace @partner-agent/frontend
```
