# Partner Agent

Partner Agent 是一个面向个人长期信息管理、行动跟踪、目标管理和决策辅助的个人助手项目。

当前仓库同时保存产品需求、架构设计和产品自有代码。Monorepo、共享契约、持久会话恢复、工具边界、确认事务、WS v1 和 Expo 前端骨架已经落地；其余业务 handler 仍在逐项实现。

## 仓库边界

`partnerAgent` 是产品主仓库，负责维护：

- 需求、架构和技术决策文档；
- NestJS 业务后端；
- Expo / React Native 前端项目；
- 未来的 Python AI/RAG 项目；
- 数据库迁移、部署配置和项目级脚本；
- 前后端及 AI 服务之间的接口契约。

根目录可选的 `pi/` 是从官方仓库克隆的**本地参考项目**，用于 Agent 阅读、学习和源码分析，不属于本产品代码，也不会被提交到本仓库。根目录 `.gitignore` 已明确忽略 `/pi/`；当前检出中没有该目录。

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
│   └── 04-设计/                  # 前端设计参考图
├── apps/
│   └── partner-agent-backend/    # 当前 NestJS 后端
├── packages/
│   └── contracts/                # REST / WebSocket 共享契约
├── services/                     # 未来 Python AI/RAG 服务
└── pi/                           # 可选本地 Pi 源码，仅供参考，不纳入 Git
```

未来项目继续放在当前 Workspace 边界内：

```text
├── apps/partner-agent-frontend/  # 已初始化的 Expo 前端
├── services/partner-agent-ai/    # 未来 Python AI/RAG 服务
├── infra/                        # 未来部署和基础设施配置
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

截至 2026 年 9 月 4 日：

- npm workspaces 和 NestJS 后端目录迁移已完成；
- P0 决策已收口为正式基线，`@partner-agent/contracts` 提供 REST Command/Query 与 WebSocket v1 共享契约；
- 使用 HS256 JWT 的 `sub` 识别可信用户；
- 支持按用户校验 `sessionId` 所有权、隔离限额、取消，以及带消息序号水位和完整工具上下文的会话恢复；
- 已接入无副作用的 `get_current_time` 工具；
- `/api/v1` 已登记 36 个 Command 和 37 个 Query，健康检查、会话归属查询和 `SubmitConfirmationBatch` 已接通，其余 handler 显式返回 501；
- Local Core Entity/Migration 已加固，复用并扩展现有会话/消息表，候选 24 小时期限和高风险单候选由数据库约束；
- `/ws/v1` 已实现认证订阅、按频道授权、顺序推送、断线重放和恢复提示；旧 Agent WS 仅保留兼容；
- Expo / React Native 前端已初始化并消费共享 contracts，真实聊天闭环仍需继续联调；
- `SubmitConfirmationBatch` 已接通 PostgreSQL 原子事务；正式事实、目标、行动和长期记忆的其余 handler 仍需逐项接通，且只能经该事务生效。

## 后续启动顺序

恢复开发后，建议按以下顺序推进：

1. 在真实 PostgreSQL 16 环境执行 Local Core migration up → down → up 与约束验证；
2. 逐项实现目前显式返回 501 的候选、确认历史、撤销资格和任务查询；
3. 为 WS v1 的 task/operation 频道接入权威所有权数据源，再迁移旧 `chat/cancel/resume_session` 通道；
4. 联调正式前端，随后接入 Python AI/RAG。

## 仓库拆分原则

当前不按语言或框架拆分仓库。只要前端、NestJS 和 Python 服务仍然共同服务于同一个产品、需要同步接口和需求，就继续使用本仓库。

只有在团队、权限、发布周期或部署边界真正独立后，才考虑拆分为多个仓库。
