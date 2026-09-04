# Pi Agent 基座分析文档

> 本文档用于指导如何将 Pi Agent 作为个人助手项目的 Agent 运行基座
> 
> 最后更新：2026年9月4日

## 一、项目概览

Pi Agent 是一个开源 AI Agent 工具包，提供统一的 LLM 接口和完整的 Agent 运行时。

**仓库地址**: https://github.com/earendil-works/pi

**核心价值**:
- ✅ 统一的多提供商 LLM API（OpenAI、Anthropic、Google 等）
- ✅ 完整的 Agent 运行时（工具调用、状态管理、会话管理）
- ✅ 可扩展的架构（自定义工具、插件系统）
- ✅ TypeScript/Bun Monorepo 架构

---

## 二、核心包结构

Pi Agent 采用 monorepo 架构，包含以下核心包：

### 2.1 `@earendil-works/pi-ai` - 统一 LLM API

**功能**: 多提供商 LLM 统一接口，自动模型发现和提供商配置

**支持的提供商**:
- OpenAI / Azure OpenAI
- Anthropic (Claude)
- Google (Gemini) / Vertex AI
- Amazon Bedrock
- DeepSeek、Mistral、Groq、Cerebras、xAI
- OpenRouter、Together AI、Fireworks
- 任何 OpenAI 兼容的 API（Ollama、vLLM、LM Studio）

**核心特性**:
- 统一的 `stream()` 和 `complete()` API
- 自动 API Key 解析（环境变量、OAuth）
- Token 计数和成本追踪
- 工具调用（Tool Calling）支持
- 图片输入和生成支持
- Thinking/Reasoning 支持

**安装**:
```bash
npm install @earendil-works/pi-ai
```

**基础用法**:
```typescript
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';

// 创建 Models 集合
const models = createModels();
models.setProvider(anthropicProvider());
models.setProvider(openaiProvider());

// 获取模型
const model = models.getModel('anthropic', 'claude-sonnet-4-6');

// 构建上下文
const context = {
  systemPrompt: 'You are a helpful assistant.',
  messages: [
    { role: 'user', content: 'Hello!', timestamp: Date.now() }
  ],
  tools: [] // 可选的工具定义
};

// 流式调用
const stream = models.stream(model, context);
for await (const event of stream) {
  if (event.type === 'text_delta') {
    process.stdout.write(event.delta);
  }
}

// 或非流式调用
const response = await models.complete(model, context);
console.log(response.content);
```

---

### 2.2 `@earendil-works/pi-agent-core` - Agent 运行时

**功能**: 有状态的 Agent，包含工具执行和事件流

**核心特性**:
- Agent 状态管理（system prompt、model、tools、messages）
- 工具调用和执行（并行/串行模式）
- 事件流（`agent_start`, `turn_start`, `message_update`, `tool_execution_*`, `turn_end`, `agent_end`）
- Steering 和 Follow-up 消息队列
- 自定义消息类型支持
- 上下文转换和压缩

**安装**:
```bash
npm install @earendil-works/pi-agent-core
```

**基础用法**:
```typescript
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';

const models = createModels();
models.setProvider(anthropicProvider());
const model = models.getModel('anthropic', 'claude-sonnet-4-6');

// 创建 Agent
const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model,
    tools: [], // 工具数组
    messages: []
  },
  streamFn: models.streamSimple.bind(models)
});

// 订阅事件
agent.subscribe((event) => {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

// 发送消息
await agent.prompt('Hello, how are you?');

// 获取状态
console.log(agent.state.messages);
```

---

### 2.3 `@earendil-works/pi-coding-agent` - 编码 Agent CLI

**功能**: 交互式编码 Agent 命令行工具

**包含工具**:
- Read、Write、Edit 文件工具
- Bash 命令执行
- 会话管理
- TUI（终端用户界面）

**注意**: 这个包是完整的 CLI 工具，你的项目可能不需要直接使用，但可以参考其工具实现。

---

### 2.4 其他包

- `@earendil-works/chord` - 服务组合运行时
- `@earendil-works/pi-tui` - 终端 UI 库
- `@earendil-works/pi-telemetry` - 遥测和监控

---

## 三、核心概念

### 3.1 Context（上下文）

`Context` 是 Pi Agent 的核心数据结构：

```typescript
interface Context {
  systemPrompt: string;           // 系统提示词
  messages: Message[];            // 消息历史
  tools?: Tool[];                 // 工具定义（可选）
}
```

**Message 类型**:
- `user`: 用户消息
- `assistant`: 助手消息
- `toolResult`: 工具执行结果

### 3.2 Tool（工具）

工具使用 TypeBox 定义参数 Schema：

```typescript
import { Type } from '@earendil-works/pi-ai';

const myTool = {
  name: 'read_file',
  label: 'Read File',
  description: 'Read a file\'s contents',
  parameters: Type.Object({
    path: Type.String({ description: 'File path' })
  }),
  execute: async (toolCallId, params, signal, onUpdate) => {
    const content = await fs.readFile(params.path, 'utf-8');
    return {
      content: [{ type: 'text', text: content }],
      details: { path: params.path, size: content.length }
    };
  }
};
```

### 3.3 Agent 事件流

Agent 运行时发出以下事件：

```
prompt("Hello")
├─ agent_start                    # Agent 开始
├─ turn_start                     # 回合开始
├─ message_start { userMessage }  # 用户消息开始
├─ message_end   { userMessage }  # 用户消息结束
├─ message_start { assistantMsg } # 助手消息开始
├─ message_update { partial... }  # 流式输出（多次）
├─ message_end   { assistantMsg } # 助手消息结束
├─ turn_end                       # 回合结束
└─ agent_end                      # Agent 结束
```

如果有工具调用：

```
├─ tool_execution_start { toolCallId, toolName, args }
├─ tool_execution_update { partialResult }  # 可选的进度更新
├─ tool_execution_end { toolCallId, result }
├─ message_start/end { toolResultMessage }
├─ turn_end { toolResults }
├─ turn_start                               # 新回合：模型响应工具结果
└─ ...
```

---

## 四、与你的项目集成

### 4.1 你的项目架构（回顾）

根据 `个人助手项目交接文档.md`，你的项目架构：

```
前端: Expo + TypeScript (React Native)
├─ 聊天首页（陪伴聊天、辅助解答）
├─ 行动协助（目标、行动候选）
├─ 确认中心
└─ 记忆/事实管理

后端: NestJS + TypeScript
├─ Local Core (命令/查询接口)
├─ Agent 层 (Pi Agent Core)
├─ AI 层 (模型调用)
└─ Python FastAPI (结构化分析)

数据: PostgreSQL + pgvector
├─ 原始记录
├─ 结构化数据（目标、行动、事实、长期记忆）
└─ RAG 检索

模型: 多提供商支持
├─ Anthropic Claude
├─ OpenAI
└─ 其他（通过 Pi AI 统一接口）
```

### 4.2 推荐集成方案

#### 方案一：NestJS 中直接集成（推荐）

在 NestJS 服务中使用 Pi Agent 作为底层：

```typescript
// src/agent/agent.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Agent } from '@earendil-works/pi-agent-core';
import { createModels } from '@earendil-works/pi-ai';
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';

@Injectable()
export class AgentService implements OnModuleInit {
  private models: Models;
  private agents: Map<string, Agent> = new Map();

  onModuleInit() {
    // 初始化模型集合
    this.models = createModels();
    this.models.setProvider(anthropicProvider());
    this.models.setProvider(openaiProvider());
  }

  async createAgentSession(userId: string, config: AgentConfig) {
    const model = this.models.getModel(
      config.provider,
      config.modelId
    );

    const agent = new Agent({
      initialState: {
        systemPrompt: config.systemPrompt,
        model,
        tools: this.buildTools(userId), // 你的自定义工具
        messages: []
      },
      streamFn: this.models.streamSimple.bind(this.models),
      sessionId: userId
    });

    // 订阅事件并处理
    agent.subscribe((event) => {
      this.handleAgentEvent(userId, event);
    });

    this.agents.set(userId, agent);
    return agent;
  }

  async sendMessage(userId: string, message: string) {
    const agent = this.agents.get(userId);
    if (!agent) throw new Error('Agent not found');

    await agent.prompt(message);
    return agent.state.messages;
  }

  private buildTools(userId: string) {
    return [
      // 你的自定义工具
      this.buildRagSearchTool(userId),
      this.buildGoalCreationTool(userId),
      this.buildActionCreationTool(userId),
      // ...
    ];
  }

  private buildRagSearchTool(userId: string) {
    return {
      name: 'search_memory',
      description: 'Search user memories and facts',
      parameters: Type.Object({
        query: Type.String({ description: 'Search query' }),
        scope: Type.Optional(Type.Union([
          Type.Literal('facts'),
          Type.Literal('memories'),
          Type.Literal('goals'),
          Type.Literal('actions')
        ]))
      }),
      execute: async (toolCallId, params) => {
        // 调用你的 RAG 服务
        const results = await this.ragService.search(userId, params.query, params.scope);
        return {
          content: [{ type: 'text', text: JSON.stringify(results) }],
          details: { resultCount: results.length }
        };
      }
    };
  }

  private handleAgentEvent(userId: string, event: AgentEvent) {
    // 事件处理：存储消息、更新状态、触发前端通知等
    switch (event.type) {
      case 'message_end':
        // 保存消息到数据库
        break;
      case 'tool_execution_end':
        // 记录工具调用
        break;
      // ...
    }
  }
}
```

### 4.3 关键集成点

#### 4.3.1 工具调用示例

**RAG 检索工具**:

```typescript
const ragTool = {
  name: 'search_context',
  label: 'Search Personal Context',
  description: 'Search user\'s memories, facts, goals, and past actions',
  parameters: Type.Object({
    query: Type.String({ description: 'What to search for' }),
    types: Type.Optional(Type.Array(Type.Union([
      Type.Literal('memory'),
      Type.Literal('fact'),
      Type.Literal('goal'),
      Type.Literal('action')
    ])))
  }),
  execute: async (toolCallId, params, signal) => {
    const results = await ragService.search({
      userId,
      query: params.query,
      types: params.types || ['memory', 'fact', 'goal'],
      limit: 10
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2)
      }],
      details: { resultCount: results.length }
    };
  }
};
```

**目标创建工具**:

```typescript
const createGoalTool = {
  name: 'propose_goal',
  label: 'Propose Goal',
  description: 'Propose a new goal for user confirmation',
  parameters: Type.Object({
    title: Type.String({ description: 'Goal title' }),
    description: Type.Optional(Type.String()),
    deadline: Type.Optional(Type.String({ description: 'ISO date string' }))
  }),
  execute: async (toolCallId, params) => {
    const candidate = await goalService.createCandidate({
      ...params,
      status: 'pending_confirmation',
      userId
    });

    return {
      content: [{ type: 'text', text: `Goal candidate created: ${candidate.id}` }],
      details: { candidateId: candidate.id },
      terminate: true // 告诉 agent 停止，等待用户确认
    };
  }
};
```

#### 4.3.2 会话持久化

```typescript
// 定期保存
agent.subscribe(async (event) => {
  if (event.type === 'turn_end') {
    await sessionService.saveMessages(userId, agent.state.messages);
  }
});

// 恢复会话
async restoreAgent(userId: string) {
  const savedMessages = await sessionService.getMessages(userId);
  
  const agent = new Agent({
    initialState: {
      systemPrompt: this.getSystemPrompt(userId),
      model,
      tools: this.buildTools(userId),
      messages: savedMessages // 恢复历史
    },
    streamFn: this.models.streamSimple.bind(this.models)
  });

  return agent;
}
```

---

## 五、下一步行动

### 5.1 技术验证（立即可做）

```bash
cd backend
npm install @earendil-works/pi-ai @earendil-works/pi-agent-core typebox
```

### 5.2 关键决策点

1. **会话管理策略**: 每个用户一个长期实例 vs 每次对话创建新实例
2. **上下文压缩**: 何时触发？使用 Pi Agent 的 compaction 还是自己实现？
3. **工具权限**: 哪些工具需要用户确认？哪些可以自动执行？

---

## 六、参考资源

- **项目主页**: https://pi.dev
- **GitHub**: https://github.com/earendil-works/pi
- **本地克隆**: `./pi/`
- **关键文档**:
  - `./pi/packages/ai/README.md` - pi-ai 完整文档
  - `./pi/packages/agent/README.md` - pi-agent-core 完整文档
  - `./pi/README.md` - 项目总览

---

*文档作者：Claude*  
*用于：个人助手项目 - Pi Agent 集成评估*
