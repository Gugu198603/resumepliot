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
- 多 Agent 面试追问、回答评估、精简版 / 详细版简历改写
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

## 产品闭环

1. 导入简历，系统生成统一 Candidate Profile 和可追溯证据。
2. 粘贴或抓取目标 JD，得到语义分、证据支持分和逐项差距。
3. 基于目标岗位生成简历，在事实校验通过后保存为版本。
4. 对版本做字段级 diff，并导出 DOCX 或通过浏览器打印为 PDF。
5. 使用同一份简历开始模拟面试；每轮保存量化评分，最终在面试记录中查看薄弱项。

相关接口：

- `GET /api/resumes/:id/profile`
- `GET|POST /api/resumes/:id/versions`
- `GET /api/resume-versions/:id/diff?baseId=...`
- `GET /api/resume-versions/:id/export.docx`
- `GET /api/sessions/:id/report`

## 目录结构

- `frontend/`：React + Vite 页面
- `server/`：Express API、多 agent、服务层
- `prisma/`：Prisma schema 与 SQLite 数据库
- `data/latest.json`：最近一次解析结果

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
```

真实 HTTP/SSE 集成测试需要监听临时本机端口，单独运行：

```bash
RUN_HTTP_INTEGRATION=true node --test tests/apiIntegration.test.js
```

覆盖：简历解析、jdMatcher、resumeComparer（多简历指标/关键词差异）、interviewer（连续追问深度递进）、llmClient、skill workflow、JSON 数据层（含 Session.resumeId 持久化、resume 重命名/删除、JobDescription dedupe、JobMatch）、jobSources 适配器层（含关键词/地域过滤）与调度器去重、LLM 成本与延迟聚合。

## 下一步可做的方向

- 面试评分体系与可量化反馈报告
- 简历改写版本对比与一键导出
- 岗位抓取扩展更多数据源（LinkedIn / 自建爬虫）
- 登录、作品集、分享链接；语音面试模式

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
