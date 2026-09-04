# Pi Agent 目录说明

> **已归档：** 本文只记录 2026 年 9 月 4 日的 Pi 本地参考目录快照。`pi/` 是可选且被 Git 忽略的外部源码，不是产品交付物；目录内容和绝对路径均不作为当前事实。当前项目结构见 [`项目架构说明`](../01-项目/项目架构说明.md)。
>
> 本文档说明 Pi Agent 源码和分析文档的目录位置
> 
> 最后更新：2026年9月4日

## 一、目录结构

```
partnerAgent\
├── pi/                                    # Pi Agent 源码（从 GitHub 克隆）
│   ├── packages/                          # 核心包目录
│   │   ├── ai/                           # @earendil-works/pi-ai
│   │   │   ├── src/                      # 源码
│   │   │   ├── package.json              # 包配置
│   │   │   └── README.md                 # pi-ai 完整文档 ⭐
│   │   ├── agent/                        # @earendil-works/pi-agent-core
│   │   │   ├── src/                      # 源码
│   │   │   ├── package.json              # 包配置
│   │   │   └── README.md                 # pi-agent-core 完整文档 ⭐
│   │   ├── coding-agent/                 # @earendil-works/pi-coding-agent
│   │   │   ├── src/                      # 源码
│   │   │   ├── package.json              # 包配置
│   │   │   └── README.md                 # coding-agent 文档
│   │   ├── chord/                        # @earendil-works/chord
│   │   ├── tui/                          # @earendil-works/pi-tui
│   │   ├── telemetry/                    # @earendil-works/pi-telemetry
│   │   ├── protocol/                     # @earendil-works/pi-protocol
│   │   ├── client/                       # @earendil-works/pi-client
│   │   ├── server/                       # @earendil-works/pi-server
│   │   └── session-backends/             # 会话后端
│   ├── scripts/                          # 构建脚本
│   ├── package.json                      # Monorepo 配置
│   ├── README.md                         # 项目主 README ⭐
│   └── ...
│
├── pi-agent-分析文档.md                  # Pi Agent 详细分析文档 ⭐⭐⭐
├── Pi-Agent-目录说明.md                  # 本文档
│
├── docs/02-需求/                    # 你的项目需求文档
│   ├── 个人助手项目交接文档.md
│   ├── v1-技术架构总览.md
│   ├── v1-技术选型方案.md
│   └── ...
│
└── (未来的后端/前端代码目录)
```

---

## 二、关键文件位置

### 2.1 必读文档

| 文件 | 路径 | 说明 |
|------|------|------|
| **Pi Agent 分析文档** | `./pi-agent-分析文档.md` | **⭐ 最重要** - 详细的集成指南和代码示例 |
| Pi Agent 主 README | `../../pi/README.md` | 项目总览和开发指南 |
| pi-ai README | `../../pi/packages/ai/README.md` | 统一 LLM API 完整文档（89KB） |
| pi-agent-core README | `../../pi/packages/agent/README.md` | Agent 运行时完整文档 |
| 个人助手交接文档 | `./docs/02-需求/个人助手项目交接文档.md` | 你的项目需求和架构 |

### 2.2 核心包源码

| 包名 | 源码路径 | 入口文件 |
|------|---------|---------|
| `@earendil-works/pi-ai` | `../../pi/packages/ai/src/` | `index.ts` |
| `@earendil-works/pi-agent-core` | `../../pi/packages/agent/src/` | `index.ts` |
| `@earendil-works/pi-coding-agent` | `../../pi/packages/coding-agent/src/` | `index.ts` |

### 2.3 示例和测试

| 类型 | 路径 | 说明 |
|------|------|------|
| pi-ai 测试 | `../../pi/packages/ai/test/` | 模型调用测试用例 |
| pi-agent 测试 | `../../pi/packages/agent/test/` | Agent 测试用例 |
| coding-agent 示例 | `../../pi/packages/coding-agent/examples/` | 扩展示例 |

---

## 三、使用指南

### 3.1 第一步：阅读分析文档

```bash
# 查看分析文档
code pi-agent-分析文档.md
# 或
open pi-agent-分析文档.md
```

该文档包含：
- ✅ Pi Agent 核心概念
- ✅ 与你项目的集成方案
- ✅ 完整的代码示例
- ✅ 下一步行动建议

### 3.2 第二步：查看官方文档

```bash
# pi-ai 完整 API 文档
code pi/packages/ai/README.md

# pi-agent-core 完整 API 文档
code pi/packages/agent/README.md
```

### 3.3 第三步：浏览源码

```bash
# 查看核心 API 导出
code pi/packages/ai/src/index.ts
code pi/packages/agent/src/index.ts

# 查看 Agent 实现
code pi/packages/agent/src/agent.ts
code pi/packages/agent/src/agent-loop.ts
```

### 3.4 第四步：安装依赖（准备集成时）

```bash
# 在你的后端项目中
npm install @earendil-works/pi-ai @earendil-works/pi-agent-core typebox
```

---

## 四、快速索引

### 4.1 我想了解...

| 需求 | 参考文档 | 位置 |
|------|---------|------|
| 如何集成到 NestJS | Pi Agent 分析文档 > 四、与你的项目集成 | `./pi-agent-分析文档.md` |
| 支持哪些 LLM 提供商 | pi-ai README > Supported Providers | `../../pi/packages/ai/README.md` |
| 如何定义工具 | pi-agent-core README > Tools | `../../pi/packages/agent/README.md` |
| Agent 事件流 | pi-agent-core README > Event Flow | `../../pi/packages/agent/README.md` |
| 代码示例 | Pi Agent 分析文档 > 四.3 关键集成点 | `./pi-agent-分析文档.md` |

### 4.2 常用命令

```bash
# 查看 Pi 项目结构
ls -la pi/packages/

# 搜索某个 API
grep -r "createModels" pi/packages/ai/src/

# 查看包版本
cat pi/packages/ai/package.json | grep version
cat pi/packages/agent/package.json | grep version
```

---

## 五、目录管理建议

### 5.1 保持 Pi 源码作为参考

Pi 源码目录 (`../../pi/`) 建议保留作为参考，但不要直接修改：

```bash
# 好的做法 ✅
# 在你的项目中通过 npm 安装 Pi 包
cd backend
npm install @earendil-works/pi-ai @earendil-works/pi-agent-core

# 不好的做法 ❌
# 不要直接修改 ../../pi/ 下的源码
```

### 5.2 创建你的项目代码

建议在 `partnerAgent/` 下创建独立的后端和前端目录：

```
partnerAgent/
├── pi/                    # Pi 源码（只读参考）
├── pi-agent-分析文档.md   # 集成指南
├── backend/               # 你的 NestJS 后端 ⬅ 新建
│   ├── src/
│   │   ├── agent/        # Agent 服务
│   │   ├── rag/          # RAG 服务
│   │   └── ...
│   └── package.json
├── frontend/              # 你的 Expo 前端 ⬅ 新建
└── docs/02-需求/            # 需求文档
```

### 5.3 版本管理

```bash
# Pi 源码建议添加到 .gitignore
echo "pi/" >> .gitignore

# 你的项目代码正常提交
git add backend/ frontend/ pi-agent-分析文档.md
git commit -m "feat: 添加后端和前端项目"
```

---

## 六、常见问题

### Q1: Pi 源码可以删除吗？

**建议保留**。虽然你会通过 npm 安装 Pi 包，但保留源码可以：
- 快速查看实现细节
- 参考测试用例
- 调试时查看源码

如果空间紧张，可以删除 `pi/node_modules/` 和 `pi/.git/`。

### Q2: 如何更新 Pi Agent？

```bash
# 方式 1: 拉取最新代码（如果保留了 .git）
cd pi
git pull origin main

# 方式 2: 在你的项目中更新包
cd backend
npm update @earendil-works/pi-ai @earendil-works/pi-agent-core
```

### Q3: 分析文档够用吗？

**分析文档是快速入门指南**，包含：
- 核心概念
- 集成方案
- 代码示例

**官方 README 是完整 API 参考**，包含：
- 所有 API 接口
- 详细参数说明
- 高级用法

建议：先读分析文档理解整体，需要细节时查官方 README。

---

## 七、当时的下一步（已归档）

1. ✅ 已完成：克隆 Pi Agent 源码
2. ✅ 已完成：创建分析文档
3. ⏭️ **下一步**：阅读 [pi-agent-分析文档.md](./pi-agent-分析文档.md)
4. ⏭️ 然后：创建 `backend/` 目录并初始化 NestJS 项目
5. ⏭️ 然后：安装 Pi Agent 包并开始集成

---

*文档作者：Claude*  
*用于：个人助手项目 - Pi Agent 目录管理*
