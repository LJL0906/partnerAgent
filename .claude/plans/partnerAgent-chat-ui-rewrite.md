# 聊天区域 UI/滚动/键盘层重写方案

> 经用户确认范围:只重写 UI/滚动/键盘层,保留已验证的引擎层(use-chat、session-management、chat-message-submission、chat-event-state、chat-event-routing、store/chat-store、api/*)。

## 目标

消除三个真机问题,提供稳定、无兼容补丁的实现:
1. Android 聚焦输入框时键盘遮挡(闪烁已修但遮挡仍在)。
2. 流式回复期间"回到最新消息"按钮闪现。
3. 用户滚到哪就自动被拉回底部(尤其 Android Studio 模拟器/真机)。

## 待删除

- `src/features/chat/消息贴底策略.ts` + `消息贴底策略.spec.ts`(2px 容差猜贴底、onScroll/onContentSizeChange 竞态问题根源)——只被 chat-screen 引用,可安全删除。
- `chat-screen.tsx` 中旧的 `createBottomFollowPolicy`/`scheduleFollow`/rAF 逐帧滚动方案。

# 重写设计

## 滚动:单一状态驱动,不做几何猜测

核心思路:一个布尔 `isPinned` 决定行为,不依赖 offset 数学。

- **消息列表** `ScrollView`(messages 少,removeClippedSubviews 无意义;FlatList 的 onViewport 兼容问题也一并规避)。
- `isPinned === true` 时:新增消息 → `onContentSizeChange` 触发一次 `scrollToEnd(animated: false)`,视图永远停在最新消息。
- `isPinned === false` 时:用户自由滚动,内容增长**不**触发 scrollToEnd;但用户滚到底时 `isPinned` 恢复 true,并立即 `scrollToEnd`。
- 只用 `onScroll` 判断手指滚动方向:
  - 滚动 + 且 `isPinned` → 设 `isPinned = false`(暂停)
  - 滚动到最底(`contentOffset.y >= contentSize.height - viewportHeight - 容差`)→ 设 `isPinned = true`(恢复)
- 初始加载、切会话、冷启动:`isPinned` 恢复 true,首次渲染后 `scrollToEnd`。
- **不做** 2px 精确扫描、不做 "测量到距底距离" 的逐帧判断;状态只有 pinned/unpinned,行为确定。
- 触摸回调:`onTouchStart/onTouchEnd` 用于记录手指是否在拖动,能更可靠地区分"用户主动上滑"和"程序化滚动到端"。**简化**:`onScroll` 的 距底 检查是权威的—用户上滑时距底变大 → unpin;用户滚到底 → pin。

## "回到最新"按钮

只显示在没有 pinned 时(有未读/未跟随内容):

- `showNewMessageButton = !isPinned && hasPinnedOffset > threshold`。但不用 offset 精确计算,直接:若 !isPinned 就显示按钮(只要用户离开了底,就可能想回)。
- 点击按钮:设 `isPinned=true`, `scrollToEnd`,并标记一新会话 revision 的"已回到底",防跨会话串场。
- **保留** chat-screen 的 `scrollNotice.revision` 隔离逻辑,但只需单状态。

## 键盘:平台分离,不用兼容

- **Android**:移除 `KeyboardAvoidingView`(只在 iOS 用)。依赖系统 `adjustResize` + `android:windowSoftInputMode`,并把 app.json 的 `android.softwareKeyboardLayoutMode: "resize"` 显式设置。
  - **注意**:原生 Android「edge-to-edge」会让 adjustResize 失效。**Expo Go 当前不启用 edge-to-edge**,因此系统 resize 生效;**Android Studio 模拟器和正式构建**若开启了 edge-to-edge,KeyboardAvoidingView 才是正解。为覆盖面最大化:**保留 KeyboardAvoidingView 但只在 iOS 扩展启用**,Android 走系统 resize。
  - 但用户现在遇到 Android(Expo Go)遮挡——说明 Expo Go 的 resize 已生效(系统)或需 KAV。**待验证**:先用原生 resize,若遮挡则回退 KAV(一个常量区分)。
- **iOS**:`KeyboardAvoidingView` `behavior="padding"` + `keyboardVerticalOffset`=顶部 insets。

## 输入框

- 发送后 **收键盘 + 失焦**(已确认需求)。用 `Keyboard.dismiss()`(cross-platform)。
- 发送状态:发送按钮用于 `isStreaming` 切换为取消按钮;发送成功后收键盘。
- 不改引擎 `onSend` 契约:`onSend(message): Promise<boolean>` → 返回 true 才收键盘清空。

## 组件重写

- `chat-screen.tsx`:从零写。包含 AppHeader、ConnectionStatus、消息 ScrollView、回到最新按钮、ChatInput。
- `chat-input.tsx`:从零写。仅负责输入、发送/取消、聚焦态(2px 边框颜色切换),监听 onSend 返回值收键盘清空。
- `message-bubble.tsx`:保留现有样式逻辑(工具/系统/用户/助手、纯文本),原实现已稳定,微调空白。

## 引擎契约(UI 依赖的,保持稳定)

- `useChat()` 返回 `{ sendMessage, stopStreaming, isStreaming }` —— 不变。
- `useConversationStore`: `{ sessions, loading, opening, error, ready }`,函数 `new会话/ open会话/ refreshsession-list/ retry会话` —— 原样。
- `useChatStore`: `{ sessionId, sessionRevision, sessionPersisted, activeTaskId, activeOperationId, messages, isStreaming, isThinking, connectionStatus, taskStatus, privacyDecision }` —— 原样。
- `ConnectionStatus` 组件原实现,保留。
- 会话切换:chat-screen 在 `sessionRevision` 变化时重置 scroll 到端。

## 校验

修改后运行:前端 `vitest`、`tsc --noEmit`、`expo lint`。新增一个 `use-chat` 无关的 `消息贴底策略` 已被删除,因此由 ScrollView 的 `onScroll` 测试替代。补一个 UI 测试(chat-screen scroll logic) 或直接用单元测试锁定 isPinned 布尔逻辑。

# 修改文件清单

新增:
- `src/features/chat/components/chat-screen.tsx`(重写)
- `src/features/chat/components/chat-input.tsx`(重写)
- `src/hooks/useMessageScroll.ts`(新,滚动状态机)

修改:
- `app.json`(android `softwareKeyboardLayoutMode: "resize"`)
- 若 KAV 兜底:`chat-screen.tsx` 键盘容器

删除:
- `src/features/chat/消息贴底策略.ts`
- `src/features/chat/消息贴底策略.spec.ts`

保留:
- `features/chat/` 其余(use-chat/session-management/chat-message-submission/chat-event-state/chat-event-routing/session-store)
- `store/chat-store.ts`、`api/*`、全部引擎层

# 验收(用户真机)

1. Android Expo Go + 模拟器:聚焦输入框不再被遮挡、键盘收放稳定、发送后失焦。
2. 滚动:默认贴底;上滑暂停且停在原位;滚到底/点"回到最新"恢复;回复增长时不自动跳回。
3. "回到最新"按钮只在未跟随且内容超一屏时出现,不再闪现。
4. 会话切换、冷启动,序列不串。
