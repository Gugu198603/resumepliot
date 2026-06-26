# ResumePilot

一个为了“边学边拆”而做的 AI 求职产品原型，重点不是花哨页面，而是把这 3 个学习点做成你能继续扩展的最小闭环：

1. **RAG 思路**：先把简历切 chunk，再做检索，再把检索结果送进问答/追问模块
2. **向量数据库思路**：当前用本地词频 embedding + 相似度计算模拟，后续你可以替换成真实 embedding + vector DB
3. **Agent 思路**：当前把“解析 -> 检索 -> 追问 -> 评估 -> 改写”做成多角色链路，后续可以继续拆成 planner / retriever / interviewer / critic

## 当前已经做好的功能

- PDF / 文本简历导入
- 简历结构化拆分
- 风险术语识别
- 本地 RAG 检索原型（chunk + embedding + similarity）
- 面试追问生成
- 回答评估
- 精简版 / 详细版简历改写

## 目录结构

- `frontend/`：React + Vite 页面
- `server/`：Express API
- `data/latest.json`：最近一次解析结果

## 启动方式

```bash
cd /Users/bytedance/Documents/Codex/2026-06-20/files-mentioned-by-the-user-pdf/work/resumepilot
npm install
npm run dev
```

前端默认在：`http://localhost:5173`
后端默认在：`http://localhost:8787`

## 你接下来 1 小时后最该做的 3 件事

### 1. 把本地假 embedding 替换成真实 embedding
现在在 `server/index.js` 里：
- `embed(text)`
- `similarity(a, b)`
- `retrieveTopK(...)`

这是一个简化版“假向量检索”。

你接下来可以替换成：
- OpenAI embedding / 其它 embedding API
- 或本地 embedding 模型

然后把结果存到真实向量库。

### 2. 把内存 KB 替换成真实向量数据库
当前知识库是：
- chunk 切分
- 直接数组存内存
- 本地算相似度

你后面可以换成：
- pgvector
- Milvus
- Qdrant
- Chroma

替换点主要在：
- `buildKnowledgeBase`
- `retrieveTopK`

### 3. 把问答流程升级成真正 Agent
当前只是“Agent 风格链路”，还不是复杂 agent 编排。

你可以继续拆成：
- planner：决定先问项目还是实习
- retriever：专门负责检索最相关 chunk
- interviewer：生成追问
- critic：评估回答真实性和完整性
- writer：输出精简版 / 详细版简历

## 为什么我故意没把它做复杂

因为你说你的目的就是学：
- RAG
- 向量数据库
- agent

所以这个版本特意满足两个条件：

1. **现在就能跑**
2. **你一眼能看懂接下来该改哪里**

## 推荐你的下一步升级顺序

1. 先接入真实 embedding
2. 再接入 vector DB
3. 最后再拆多 agent

不要反过来。

## 可直接写进简历的项目描述（做完升级后）

**ResumePilot｜AI 简历拆解与面试训练平台**
- 基于 RAG 思路构建简历分析与面试训练系统，支持简历切分、语义检索、追问生成与回答评估
- 设计多阶段 Agent 流程，将简历解析、检索召回、面试追问和结果评估拆分为独立角色，提高输出稳定性
- 支持精简版 / 详细版简历改写与风险术语识别，帮助用户提升简历真实性与面试表达一致性



## 通用化与多 Agent 目录

当前版本已移除任何针对特定个人简历的硬编码逻辑，系统以'任意简历文本 -> 解析 -> 检索 -> 追问 -> 评估 -> 改写'的通用流程运行。

多 agent 骨架目录：
- server/agents/planner.js
- server/agents/retriever.js
- server/agents/interviewer.js
- server/agents/critic.js
- server/agents/writer.js

聚合接口：
- POST /api/agent-run

建议你下一步把 prompts 从代码迁移到 server/prompts/ 目录，并把真实 vector DB 接到 retriever agent。


## Skills 目录

- `skills/interview-training/SKILL.md`
- `skills/resume-analysis/SKILL.md`
- `skills/resume-rewrite/SKILL.md`

这些 skill 用于定义“什么时候触发 + 如何执行 + 输出原则”。

## MCP server 骨架

- `server/mcp/server.js`
- `server/mcp/tools/parseResume.js`
- `server/mcp/tools/searchResumeChunks.js`
- `server/mcp/tools/evaluateAnswer.js`
- `server/mcp/tools/rewriteResume.js`

当前 MCP 层是一个本地骨架，已经具备：
- tool list
- tool call
- input schema
- 通用 resume parsing / retrieval / evaluate / rewrite 工具

你下一步可以把它接到真正的 MCP server runtime，或者作为你自己的 tool registry 使用。


## Qdrant 接入说明

当前项目已经补上 `server/services/vectorStore.qdrant.js`，并支持通过环境变量切换 provider：

```bash
VECTOR_STORE_PROVIDER=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=resume_chunks
QDRANT_VECTOR_SIZE=1024
```

可选：

```bash
QDRANT_API_KEY=your_key
```

说明：
- 当前实现会自动创建 collection
- 会按 `namespace` 写入不同简历的 chunk
- 检索时会按 namespace 过滤，避免不同简历互相污染

下一步建议：
1. 启动本地 Qdrant
2. 把 `/api/health` 和 `/api/agent-run` 跑通
3. 再把历史运行与用户数据切到 SQLite + Prisma


## SQLite + Prisma 接入准备

当前项目已补充：
- `prisma/schema.prisma`
- `.env.example`
- `server/services/database.prisma.js`（已接入统一入口，安装依赖后即可启用）

### 数据模型
- User
- Resume
- Session
- Run
- Message
- JobDescription

### 本地接入步骤
1. 安装 Prisma 依赖：`npm install -D prisma && npm install @prisma/client`
2. 确认 `.env` 含 `DATABASE_URL="file:./dev.db"`（SQLite 路径相对 `prisma/` 目录，最终落在 `prisma/dev.db`）
3. 生成 Prisma Client：`npm run prisma:generate`
4. 创建/同步表结构：`npm run prisma:push`
5. 迁移旧 JSON 数据（可选）：`npm run db:migrate-json`
6. 设置 `APP_DB_PROVIDER=prisma`（或保持 `auto`，安装好后会自动启用）

### 说明
`auto` 模式下若 Prisma 未安装，会静默回退到 JSON 文件，不阻塞系统运行。


## 数据库 provider 切换

当前服务层已经支持：
- `server/services/database.prisma.js`
- `server/services/database.json.js`
- `server/services/database.js` 作为统一入口

### 选择逻辑
- `APP_DB_PROVIDER=prisma`：强制使用 Prisma
- `APP_DB_PROVIDER=json`：强制使用 JSON fallback
- `APP_DB_PROVIDER=auto`（默认）：优先尝试 Prisma，失败则回退 JSON

这意味着你现在可以先以 Web App 方式继续开发，Prisma 没装好时也不会阻塞整个系统运行。
