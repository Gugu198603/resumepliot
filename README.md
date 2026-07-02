# ResumePilot

一个 AI 求职助手原型，围绕三个学习点做成了**可运行的完整闭环**（不再是模拟）：

1. **RAG**：简历切 chunk -> BGE-M3 语义 embedding -> 向量检索 -> 把命中片段送进问答/追问/评估
2. **向量数据库**：内存向量库与 Qdrant 可通过环境变量切换
3. **多 Agent**：planner / retriever / interviewer / critic / writer / jdMatcher 协作链路

## 当前已经做好的功能

- 统一 Candidate Profile：技能、事实主张、量化指标、证据 ID 与待澄清问题
- JD 证据匹配：逐条要求展示强证据 / 部分证据 / 证据缺失，并计算证据支持分
- PDF / 文本简历导入与结构化拆分
- 风险术语识别
- 真实语义检索（BGE-M3 embedding + 内存 / Qdrant 向量库）
- KnowledgeBaseVersion 生命周期：独立 namespace、激活/退役状态和 Qdrant 数据清理
- 版本化 RAG Golden Dataset，使用 HitRate、Recall@K、MRR@K 作为 CI Gate
- Skill Router 分类数据集与可解释分类模型，支持 unknown 拒绝和规则/模型融合
- 多 Agent 面试追问、回答评估、精简版 / 详细版简历改写
- Agent 长期记忆：Run Summary 跨轮召回、按简历/会话/岗位隔离、去重、晋升与过期过滤
- Memory 管理 API：检索、人工写入、归档/恢复、过期设置、手动晋升和向量同步删除
- MCP Tool Gateway：Agent 工具白名单、参数校验、超时和 Run Event 审计
- SQLite + Prisma 持久化，历史运行 / 会话可回看
- 岗位 JD 对比并落库，匹配历史可回看
- 岗位-简历差距报告：差距总结 + 命中/缺失关键词，可从已抓取岗位库直接选岗对比
- 多份简历并行管理与对比：多选 / 重命名 / 删除，并排对比基础指标、关键词差异、风险术语与岗位匹配分
- 模拟面试连续追问：背景澄清 → 方案细节 → 验证与结果 → 反思与拓展四段递进，引用上一轮回答去重深挖
- 招聘岗位抓取：Greenhouse / Lever 公开 ATS 适配器 + 定时调度器（去重入库）
- LLM 调用 trace（mode / 延迟 / token / model）在 Run 详情面板可见
- 简历版本管理与字段级 diff；岗位定向版本可导出 DOCX，浏览器打印导出 PDF
- 面试七维评分与会话复盘：具体性、技术深度、可信度、STAR、量化、清晰度、岗位相关性
- 上传大小/类型限制、URL SSRF 防护、CORS 白名单、限流与可选 Bearer Token
- 求职申请看板：关联岗位、定向简历版本和面试练习，跟踪收藏、准备、投递、面试与结果状态

## 产品闭环

1. 导入简历，系统生成统一 Candidate Profile 和可追溯证据。
2. 粘贴或抓取目标 JD，得到语义分、证据支持分和逐项差距。
3. 基于目标岗位生成简历，在事实校验通过后保存为版本。
4. 对版本做字段级 diff，并导出 DOCX 或通过浏览器打印为 PDF。
5. 使用同一份简历开始模拟面试；每轮保存量化评分，最终在面试记录中查看薄弱项。
6. 创建求职申请并绑定岗位、简历版本与面试记录，持续维护投递状态和下一步行动。

相关接口：

- `GET /api/resumes/:id/profile`
- `GET|POST /api/resumes/:id/versions`
- `GET /api/resume-versions/:id/diff?baseId=...`
- `GET /api/resume-versions/:id/export.docx`
- `GET /api/sessions/:id/report`
- `GET|POST /api/applications`
- `GET|PATCH|DELETE /api/applications/:id`
- `GET /api/application-reminders?dueBefore=...`
- `GET|POST /api/memories`
- `GET|PATCH|DELETE /api/memories/:id`
- `POST /api/memories/:id/promote`

## 目录结构

- `frontend/`：React + Vite 页面
- `server/`：Express API、多 agent、服务层
- `prisma/`：Prisma schema 与 SQLite 数据库
- `data/latest.json`：最近一次解析结果
- [模块架构说明](docs/architecture.md)

## 启动方式

```bash
cd /Users/bytedance/Documents/Codex/2026-06-20/files-mentioned-by-the-user-pdf/work/resumepilot
npm install
npm run dev
```

前端默认在：`http://localhost:5173`
后端默认在：`http://localhost:8787`

## 测试

```bash
npm test
npm run test:rag
npm run test:skill-router
npm run experiment:orchestration -- 50
```

真实 HTTP/SSE 集成测试需要监听临时本机端口，单独运行：

```bash
RUN_HTTP_INTEGRATION=true node --test tests/apiIntegration.test.js
```

覆盖：简历解析、jdMatcher、resumeComparer（多简历指标/关键词差异）、interviewer（连续追问深度递进）、llmClient、skill workflow、JSON 数据层（含 Session.resumeId 持久化、resume 重命名/删除、JobDescription dedupe、JobMatch）、jobSources 适配器层（含关键词/地域过滤）与调度器去重、LLM 成本与延迟聚合。

## 下一步可做的方向

- 登录与按用户隔离简历、会话、求职申请
- Playwright 主链路测试与 CI
- 岗位提醒、日程与下一步行动通知
- Skill Router 分类模型、Embedding 对比/微调和 LoRA 面试评价模型

## 可直接写进简历的项目描述

**ResumePilot｜AI 简历拆解与面试训练平台**
- 基于 RAG 构建简历分析与面试训练系统：BGE-M3 语义检索 + 可切换 Qdrant 向量库，支持简历切分、检索召回、追问生成与回答评估
- 设计多阶段 Agent 流程（planner/retriever/interviewer/critic/writer/jdMatcher），将各环节拆为独立角色，提高输出稳定性与可观测性
- 实现岗位 JD 抓取与匹配：对接 Greenhouse / Lever 公开 ATS API，定时调度去重入库，支持多岗位对比与匹配历史回看
- 全栈持久化（SQLite + Prisma，JSON 兜底），支持历史运行与会话回看



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
- `skills/resume-generation-skill/SKILL.md`

每个目录同时包含 `manifest.json`，声明 Skill 版本、触发词、输入/输出 Schema、
允许调用的工具、运行预算和最低路由置信度。低于阈值时路由器拒绝猜测 Skill。

Skill Router 使用版本化数据集 `datasets/skill-router.v1.json` 和字符 n-gram
多项式朴素贝叶斯模型。训练集包含四个 Skill 和 `unknown` 负样本，validation
用于校准最低置信度与 margin，test 只用于质量门禁：

```bash
npm run train:skill-router
npm run test:skill-router
npm run train:skill-router:embeddings
npm run test:skill-router:embeddings
npm run experiment:skill-router
```

模型产物位于 `models/skill-router/naive-bayes-v1.json`，记录数据集哈希、模型版本、
阈值与评测指标。`POST /api/skill-route` 返回规则分、模型概率、融合分与拒绝原因；
`GET /api/skill-router/model` 返回当前模型元数据。

Embedding 对照实验复用同一数据集，比较：

- 字符 n-gram 朴素贝叶斯
- 冻结 BGE-M3 + 类别向量原型
- 冻结 BGE-M3 + 可训练 Softmax 分类头

实验报告位于 `reports/skill-router-model-comparison.v1.json`，同时记录 Accuracy、
Macro-F1、unknown recall、coverage、编码耗时和分类头耗时。当前 Softmax 实验只训练
分类头，不代表 BGE Encoder 已完成微调。模型元数据可通过
`GET /api/skill-router/embedding-experiment` 查看。

## MCP Tool Runtime

- `server/mcp/server.js`
- `server/mcp/sdkServer.js`
- `server/mcp/stdio.js`
- `server/mcp/externalClient.js`
- `server/mcp/tools/parseResume.js`
- `server/mcp/tools/searchResumeChunks.js`
- `server/mcp/tools/evaluateAnswer.js`
- `server/mcp/tools/rewriteResume.js`

当前 MCP 层已经具备：
- tool list
- tool call
- initialize / capabilities 协商
- input schema
- 标准 content + structuredContent 返回
- Agent Tool Gateway 权限、超时与审计
- SDK 原生 stdio Server Transport
- `/api/mcp` 无状态 Streamable HTTP Server Transport
- 外部 stdio / Streamable HTTP MCP Client 与连接复用
- 通用 resume parsing / retrieval / evaluate / rewrite 工具

外部工具统一命名为 `serverId::toolName`，只有进入 Skill Manifest 的
`allowedTools` 后才可由 Agent 调用。外部 Server 通过 `MCP_EXTERNAL_SERVERS` 配置，
命令和 URL 不接受客户端请求动态覆盖。

```json
[
  {"id":"files","transport":"stdio","command":"node","args":["./mcp-files.js"]},
  {"id":"search","transport":"streamable-http","url":"https://mcp.example.com/mcp","headers":{"Authorization":"Bearer token"}}
]
```


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
- 每次重建生成独立 `KnowledgeBaseVersion` 和 namespace
- 检索时会按 namespace 过滤，避免不同简历互相污染
- 新版本激活后旧版本进入 `retired`，删除简历时同步删除全部向量
- `POST /api/knowledge-bases/cleanup` 默认 dry-run；传入 `{"dryRun":false,"retentionDays":7}` 执行清理
- `GET /api/resumes/:id/knowledge-base-versions` 查看版本链

## RAG 评测与编排对照实验

- Golden Dataset：`datasets/rag-golden.v1.json`
- `npm run test:rag`：真实 BGE embedding 回归，指标低于数据集阈值时退出码为 1
- `POST /api/rag-eval/golden`：返回版本、逐例结果和聚合指标
- `npm run experiment:orchestration -- 50`：在同一工作负载下比较原生流程、
  LangChain RunnableSequence 和 LangGraph StateGraph 的延迟与输出一致性
- `POST /api/experiments/orchestration`：可传 `iterations` 和自定义 `input`


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


## 招聘岗位抓取（Job Sources）

通过可插拔适配器从公开招聘源拉取 JD，统一归一化后落库去重（按 `dedupeKey`）。

### 内置 source

- `manual`：粘贴文本
- `url`：抓取单个网页正文（带超时 / 2MB 限制 / 失败降级）
- `greenhouse`：Greenhouse 公开 ATS API（`boards-api.greenhouse.io`），按公司 board token 拉取，带完整 HTML JD
- `lever`：Lever 公开 ATS API（`api.lever.co`），按公司 handle 拉取

### 相关接口

- `GET /api/job-sources`：列出已注册 source
- `GET /api/jobs`：已落库 JD 列表
- `GET /api/job-matches`：JD 匹配历史
- `POST /api/jobs/fetch`：`{ source, config }` 即时抓取并落库
- `GET /api/job-scheduler`：调度器状态
- `POST /api/job-scheduler/run`：手动触发一次抓取（可传 `{ jobs }` 覆盖配置）

### 定时调度

在 `.env` 配置（见 `.env.example`）：

```bash
JOB_SCHEDULER_ENABLED="true"
JOB_SCHEDULER_INTERVAL_MS="21600000"   # 6h
JOB_SCHEDULER_CONFIG='[{"source":"greenhouse","config":{"boards":["gitlab"],"limit":50}},{"source":"lever","config":{"companies":["leverdemo"],"limit":50}}]'
# 或用环境变量提供默认公司列表：
# GREENHOUSE_BOARDS="gitlab,airbnb"
# LEVER_COMPANIES="leverdemo,netflix"
```

调度器在服务启动时按 `JOB_SCHEDULER_CONFIG` 周期性抓取并 upsert 去重入库；新岗位会自动出现在 `/api/jobs`。

### 关键词与地域过滤

`greenhouse` / `lever` 的 `config` 支持 `filter`（也可平铺在 config 顶层），抓取后、入库前过滤：

```json
{"source":"greenhouse","config":{"boards":["gitlab"],"limit":50,"filter":{
  "keywords":["engineer","backend"],
  "keywordMode":"any",
  "excludeKeywords":["manager","director"],
  "location":["remote","germany"]
}}}
```

- `keywords`：数组或逗号串，匹配 title + 正文；`keywordMode` 为 `any`（默认）或 `all`
- `excludeKeywords`：命中即排除
- `location`：数组或逗号串，匹配 location + title + 正文（ATS 返回的地域字段已归一化到 `job.location`）

同样可用于即时抓取：`POST /api/jobs/fetch` body 传 `{ source, config: { ..., filter } }`。

### 扩展新 source

实现 `export const id` 与 `export async function fetchJobs(config)`（返回经 `normalizeJob` 归一化的数组），在 `server/services/jobSources/index.js` 注册即可被抓取接口与调度器复用。
