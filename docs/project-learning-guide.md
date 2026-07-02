# ResumePilot 项目学习指南

## 1. 项目定位

ResumePilot 是一个 AI 求职助手原型，核心目标是把“上传简历 -> 解析结构化 -> 向量检索 -> 面试追问 -> 回答评估 -> 简历生成/岗位匹配”做成可运行闭环。

当前技术栈：

- 前端：React + Vite + TypeScript，入口在 `frontend/src/App.tsx`
- 后端：Node.js + Express，入口在 `server/index.js`
- 数据库：SQLite + Prisma，兜底 JSON 数据层
- 向量检索：内存向量库或 Qdrant，通过环境变量切换
- LLM：OpenAI 兼容接口；未配置 Key 时走 fallback 逻辑
- 简历生成：Node 后端调用 Python skill，输出 JSON Resume 并做事实校验

## 2. 建议先掌握的业务主流程

### 简历导入与解析

1. 前端在工作台上传 PDF 或文本简历。
2. `POST /api/parse` 接收文件。
3. `pdf-parse` 提取 PDF 文本。
4. `server/services/resumeParser.js` 清洗乱码、拆分模块、识别风险术语。
5. `server/services/vectorStore.js` 根据 `VECTOR_STORE_PROVIDER` 选择内存向量库或 Qdrant。
6. `buildKnowledgeBase` 将简历切块并写入向量库。
7. `saveResumeRecord` 将简历、解析结果、chunk 元数据持久化。

重点文件：

- `server/index.js`
- `server/services/resumeParser.js`
- `server/services/vectorStore.js`
- `server/services/vectorStore.memory.js`
- `server/services/vectorStore.qdrant.js`
- `server/services/vectorStore.shared.js`
- `frontend/src/components/ResumeDetailPanel.tsx`

### 面试训练链路

1. 用户点击“开始面试”或提交回答。
2. 前端调用 `POST /api/agent-run` 或 `POST /api/sessions/:id/continue`。
3. `routeSkill` 根据目标选择 skill。
4. `resolveExecutionPlan` 将 skill 的 Workflow 转成 agent 执行步骤。
5. `runAgentWorkflow` 串行执行 parser、planner、retriever、interviewer、critic、writer。
6. 每一步写入 `RunEvent`，用于运行记录和诊断。
7. 会话轮次写入 `Session` 的 turns，前端展示为时间线。

重点文件：

- `server/services/agentRuntime.js`
- `server/services/runStateMachine.js`
- `server/services/agentRecovery.js`
- `server/router/skillRouter.js`
- `server/services/skillWorkflow.js`
- `server/agents/planner.js`
- `server/agents/retriever.js`
- `server/agents/interviewer.js`
- `server/agents/critic.js`
- `server/agents/writer.js`
- `frontend/src/components/ConversationTimeline.tsx`
- `frontend/src/components/SessionDetailPanel.tsx`
- `frontend/src/components/RunDetailPanel.tsx`

### 岗位匹配链路

1. 用户粘贴 JD、输入 URL，或从已抓取岗位中选择。
2. `POST /api/jd-match` 或 `POST /api/jobs/fetch` 处理岗位内容。
3. `server/agents/jdMatcher.js` 用 embedding 计算 JD 要求和简历 chunk 的语义覆盖度。
4. 结果落库为 `JobDescription` 和 `JobMatch`。

重点文件：

- `server/agents/jdMatcher.js`
- `server/services/jobSources/index.js`
- `server/services/jobSources/*.js`
- `server/services/jobScheduler.js`

### 简历生成链路

1. 前端“简历生成”Tab 发起预览。
2. `POST /api/resumes/:id/generation-preview` 调用 `generateResumePreview`。
3. Node 将解析后的 Resume 转成 CareerProfile。
4. Python skill 做 JSON Resume 转换、JD 优化建议和事实校验。
5. 校验失败时返回 unsupported facts，不应生成无依据内容。

重点文件：

- `server/services/resumeGeneration.js`
- `skills/resume-generation-skill/SKILL.md`
- `skills/resume-generation-skill/src/resume_generation_skill/fact_validator.py`
- `skills/resume-generation-skill/src/resume_generation_skill/json_resume.py`
- `skills/resume-generation-skill/src/resume_generation_skill/generator.py`

## 3. 目录职责

- `frontend/`：前端单页应用。主要逻辑集中在 `App.tsx`，组件在 `components/`。
- `server/index.js`：Express API 总入口，也是理解后端能力的第一站。
- `server/services/`：后端领域服务，包括解析、数据库、向量库、Agent runtime、LLM、调度器。
- `server/agents/`：具体 Agent 角色实现。
- `server/prompts/`：Agent 的系统提示词。
- `server/router/`：skill 路由。
- `datasets/skill-router.v1.json`：Skill 分类器的 train/validation/test 数据与 unknown 负样本。
- `models/skill-router/`：可复现的模型产物、数据集哈希与路由阈值。
- `server/experiments/embeddingSkillClassifier.js`：BGE 原型分类和冻结 Encoder 分类头训练。
- `reports/skill-router-model-comparison.v1.json`：三种路由模型的质量、拒绝率与延迟对照。
- `server/mcp/`：本地 MCP 工具注册与调用骨架。
- `skills/`：平台 skill 定义，其中 `resume-generation-skill` 是 Python 实现。
- `prisma/`：数据模型与迁移。
- `tests/`：Node 内置 test runner 测试。
- `data/`：JSON fallback 数据或历史产物。

## 4. 数据模型怎么读

先读 `prisma/schema.prisma`，重点理解这些表：

- `Resume`：上传简历及其解析结果。
- `Session`：一次面试训练会话。
- `Run`：一次 Agent workflow 执行。
- `RunEvent`：Run 的事件流，记录状态迁移、步骤开始/结束、RAG 检索、失败原因。
- `Message`：会话消息。
- `JobDescription`：岗位描述。
- `JobMatch`：岗位与简历匹配结果。
- `MemoryItem`：长期记忆与向量记忆。
- `KnowledgeBaseVersion`：每次简历知识库重建的内容哈希、namespace、向量 provider 和生命周期。
- `ResumeCorrectionEvent`：用户人工纠偏记录。

这个项目的关键设计是：`Run` 记录一次执行结果，`RunEvent` 记录执行过程。学习 Agent 稳定性和可观测性时，优先看这两个模型。

## 5. 前端页面结构

主入口是 `frontend/src/App.tsx`。

主导航：

- `workspace`：工作台，承载导入简历、开始面试、简历生成、岗位匹配。
- `resumes`：我的简历，查看历史简历和详情。
- `sessions`：面试记录，查看会话轮次。
- `dashboard`：管理与诊断，查看运行指标、Qdrant/LLM 状态、纠偏统计等。

核心组件：

- `ResumeDetailPanel.tsx`：简历结构化展示与纠偏。
- `SessionDetailPanel.tsx`：会话详情。
- `ConversationTimeline.tsx`：面试问答时间线。
- `RunDetailPanel.tsx`：Agent 执行详情、事件流和 LLM trace。

## 6. 后端 API 速查

- `GET /api/health`：服务健康检查。
- `POST /api/parse`：上传并解析简历。
- `GET /api/resumes`：简历列表。
- `GET /api/resumes/:id`：简历详情。
- `POST /api/resumes/:id/corrections`：提交人工纠偏。
- `POST /api/resumes/:id/generation-preview`：生成简历预览。
- `POST /api/agent-run`：执行完整 Agent workflow。
- `GET|POST /api/memories`：筛选或人工写入长期记忆。
- `PATCH|DELETE /api/memories/:id`：归档、恢复、过期或删除记忆。
- `POST /api/memories/:id/promote`：把 Run Summary 手动晋升到可绑定的长期作用域。
- `POST /api/sessions/:id/continue`：在会话中继续追问/评估。
- `GET /api/runs`、`GET /api/runs/:id`：运行记录。
- `POST /api/jd-match`：简历与 JD 匹配。
- `GET /api/dashboard`：仪表盘数据。
- `GET /api/qdrant-readiness`：Qdrant 连接状态。
- `GET /api/llm-readiness`：LLM 配置状态。
- `POST /api/rag-eval`：RAG 评测。

## 7. 学习顺序建议

第一遍先跑起来：

1. 读 `README.md`。
2. 执行 `npm install`。
3. 执行 `npm run dev`。
4. 打开 `http://localhost:5173`。
5. 上传一份简历，观察工作台、简历详情、运行记录。

第二遍看主链路：

1. 从 `frontend/src/App.tsx` 找上传简历和开始面试的函数。
2. 跳到 `server/index.js` 对应 API。
3. 顺着 API 读 `resumeParser.js`、`vectorStore.js`、`agentRuntime.js`。
4. 最后看 `server/agents/*.js`。

第三遍看工程化：

1. `prisma/schema.prisma`：看数据边界。
2. `server/services/database.js`：看 Prisma/JSON provider 切换。
3. `server/services/runStateMachine.js`：看运行状态机。
4. `server/services/agentRecovery.js`：看受控自恢复和硬停止。
5. `tests/*.test.js`：看已有行为约束。

第四遍看扩展能力：

1. `skills/*.md`：看 skill 如何描述工作流。
2. `server/services/skillWorkflow.js`：看 workflow 如何映射到 agent。
3. `server/mcp/`：看本地工具注册。
4. `skills/resume-generation-skill/`：看 Python 简历生成能力。

## 8. 常用命令

```bash
npm run dev
npm run build
npm test
npm run prisma:generate
npm run prisma:push
```

如果使用 Qdrant：

```bash
VECTOR_STORE_PROVIDER=qdrant
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=resume_chunks
QDRANT_VECTOR_SIZE=1024
```

如果使用真实 LLM：

```bash
OPENAI_API_KEY=your_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

## 9. 当前项目里最值得重点学习的设计

- RAG 检索不只检索简历，还会把历史会话作为上下文来源。
- Agent workflow 有硬性限制：最大步骤数、最大工具调用数、同一工具调用次数和超时。
- `RunEvent` 把 Agent 执行过程事件化，便于诊断失败原因。
- LLM 客户端有 fallback 模式，没有 Key 也能跑通主流程。
- 简历生成链路强调事实校验，不允许凭空编造简历实体信息。
- 数据库层支持 Prisma 和 JSON fallback，降低本地运行门槛。

## 10. 修改代码时的注意点

- UI 文案面向用户时使用业务术语，不暴露 Workflow、Session 等内部概念。
- 简历解析逻辑要保持通用，避免写死某份简历的具体内容。
- 简历生成必须保留事实校验。
- Agent 相关改动必须保留硬性执行守卫，避免死循环和异常费用。
- 页面布局不要在根级使用 `height: 100vh` 加 `overflow: hidden` 锁死滚动，除非明确处理了内部滚动区域。
- Qdrant point id 必须是 UUID 或整数。
