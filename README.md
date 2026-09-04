# Partner Agent

Partner Agent 是一个面向个人长期信息管理、行动跟踪、目标管理和决策辅助的个人助手项目。

当前仓库同时保存产品需求、架构设计和产品自有代码。Monorepo、共享契约、内存会话和首个只读工具已经落地；正式业务数据闭环仍未开始。

## 仓库边界

`partnerAgent` 是产品主仓库，负责维护：

- 需求、架构和技术决策文档；
- NestJS 业务后端；
- 未来的前端项目；
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
├── 项目架构说明.md                # 仓库边界和演进规则
├── 开发交接说明.md                # 当前实现与接手指引
├── 阶段0-4实施总结.md              # 本轮实施记录
├── 需求/                         # 产品需求、架构和技术选型文档
├── apps/
│   └── partner-agent-backend/    # 当前 NestJS 后端
├── packages/
│   └── contracts/                # WebSocket 共享契约
├── services/                     # 未来 Python AI/RAG 服务
├── pi/                           # 可选本地 Pi 源码，仅供参考，不纳入 Git
├── pi-agent-分析文档.md           # Pi 学习和分析记录
└── Pi-Agent-目录说明.md           # Pi 目录说明
```

未来项目继续放在当前 Workspace 边界内：

```text
├── apps/partner-agent-frontend/  # 未来前端
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
- `@partner-agent/contracts` 提供 WebSocket 共享契约；
- 支持按 `sessionId` 隔离、取消和恢复内存会话；
- 已接入无副作用的 `get_current_time` 工具；
- 前端和 Python AI/RAG 服务尚未初始化；
- 正式事实、目标、行动和长期记忆写入仍需等待确认中心。

## 后续启动顺序

恢复开发后，建议按以下顺序推进：

1. 建立认证、会话所有权与确认中心；
2. 设计数据库会话、消息持久化和上下文压缩；
3. 建立工具风险分级、审计和结果脱敏；
4. 初始化正式前端并消费共享 contracts；
5. 再接入 Python AI/RAG 和正式业务写入闭环。

## 仓库拆分原则

当前不按语言或框架拆分仓库。只要前端、NestJS 和 Python 服务仍然共同服务于同一个产品、需要同步接口和需求，就继续使用本仓库。

只有在团队、权限、发布周期或部署边界真正独立后，才考虑拆分为多个仓库。
