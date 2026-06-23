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

