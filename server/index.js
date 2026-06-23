import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline, env } from '@huggingface/transformers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = 8787;

env.cacheDir = path.resolve(__dirname, '../.hf-cache');
env.allowLocalModels = true;
if (process.env.HF_ENDPOINT) {
  env.remoteHost = process.env.HF_ENDPOINT;
} else {
  env.remoteHost = 'https://hf-mirror.com';
}

const EMBED_MODEL = 'Xenova/bge-m3';
let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    console.log(`[embedder] loading ${EMBED_MODEL} (first run downloads ~600MB)...`);
    embedderPromise = pipeline('feature-extraction', EMBED_MODEL, {
      quantized: true
    }).then((p) => {
      console.log('[embedder] ready');
      return p;
    });
  }
  return embedderPromise;
}

async function embedBatch(texts) {
  if (!texts.length) return [];
  const extractor = await getEmbedder();
  const output = await extractor(texts, { pooling: 'cls', normalize: true });
  const dim = output.dims[output.dims.length - 1];
  const data = output.data;
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return vectors;
}

async function embedOne(text) {
  const [v] = await embedBatch([text]);
  return v;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SYSTEM_TERMS = [
  'SSR', 'CRDT', 'RAG', '向量数据库', 'agent', '埋点', '性能优化', '兼容性', 'SDK', 'postMessage',
  '缓存', '虚拟列表', '多端适配', '监控', '渲染', 'WebWorker', 'IndexedDB', 'Tailwind', 'TypeScript'
];

function normalizeText(text = '') {
  return text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function splitSections(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = { title: '未分类', content: [] };

  for (const line of lines) {
    if (/^(教育背景|核心技能|技能栈|实习经历|工作经验|项目经历|荣誉奖项|奖项|自我评价)/.test(line)) {
      if (current.content.length) sections.push(current);
      current = { title: line, content: [] };
    } else {
      current.content.push(line);
    }
  }
  if (current.content.length) sections.push(current);
  return sections;
}

function detectRisks(text) {
  const found = SYSTEM_TERMS.filter((term) => text.toLowerCase().includes(term.toLowerCase()));
  return found.map((term) => ({
    term,
    reason: `该术语容易被面试官追问实现细节，建议准备“背景-方案-实现-结果”四段式回答。`
  }));
}

function chunkText(text, chunkSize = 220) {
  const clean = normalizeText(text);
  const paragraphs = clean.split(/\n+/).filter(Boolean);
  const chunks = [];
  let buffer = '';

  for (const p of paragraphs) {
    if ((buffer + p).length > chunkSize && buffer) {
      chunks.push(buffer.trim());
      buffer = p;
    } else {
      buffer += `${p}\n`;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

async function buildKnowledgeBase(text) {
  const chunks = chunkText(text);
  if (!chunks.length) return [];
  const vectors = await embedBatch(chunks);
  return chunks.map((chunk, index) => ({
    id: index + 1,
    content: chunk,
    embedding: vectors[index]
  }));
}

async function retrieveTopK(kb, query, topK = 3) {
  if (!kb.length) return [];
  const queryEmbedding = await embedOne(query);
  return kb
    .map((chunk) => ({ ...chunk, score: similarity(chunk.embedding, queryEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ id, content, score }) => ({ id, content, score: Number(score.toFixed(3)) }));
}

function generateQuestions(text, retrieved) {
  const focus = retrieved[0]?.content || text.slice(0, 200);
  return {
    basic: [
      '请用 1 分钟介绍这段经历里你具体负责的内容。',
      '这个项目/实习的业务目标是什么？你做的部分解决了什么问题？'
    ],
    detail: [
      `你在“${focus.slice(0, 24)}...”这部分中，具体改了哪些代码或模块？`,
      '如果让你重新做一次，你会如何拆分问题、定位问题并验证结果？'
    ],
    pressure: [
      '这些内容里哪些是你独立完成的，哪些是在同学/同事指导下完成的？',
      '如果面试官继续追问实现细节，你最可能答不稳的点是什么？你准备怎么补？'
    ]
  };
}

function rewriteResume(text) {
  const sections = splitSections(text);
  const lines = sections.flatMap((section) => {
    const top = section.content.slice(0, Math.min(4, section.content.length));
    return [`【${section.title}】`, ...top];
  });

  return {
    concise: lines.slice(0, 18).join('\n'),
    detailed: sections.map((section) => `【${section.title}】\n${section.content.join('\n')}`).join('\n\n')
  };
}

async function evaluateAnswer(answer, retrieved) {
  const len = answer.trim().length;
  const detailScore = Math.min(10, Math.floor(len / 35) + 2);

  let bestScore = 0;
  if (len > 0 && retrieved.length) {
    const texts = retrieved.map((r) => r.content);
    const [answerVec, ...chunkVecs] = await embedBatch([answer, ...texts]);
    bestScore = chunkVecs.reduce((m, v) => Math.max(m, similarity(answerVec, v)), 0);
  }
  const isRelevant = bestScore > 0.45;

  return {
    scores: {
      specificity: detailScore,
      technicalDepth: Math.max(3, Math.min(10, detailScore - 1)),
      credibility: isRelevant ? 8 : 5,
      semanticMatch: Number(bestScore.toFixed(3))
    },
    feedback: [
      len < 80 ? '回答偏短，建议补充“背景、动作、难点、结果”。' : '回答长度尚可，可以继续补足细节。',
      isRelevant ? '你的回答和简历内容语义相关性较高。' : '回答与原始经历语义关联较弱，建议多引用你实际做过的内容。',
      '建议补充一个你亲手修改过的模块、一个实际问题、一个验证结果。'
    ]
  };
}

app.get('/api/health', (_, res) => {
  res.json({ ok: true });
});

app.post('/api/parse', upload.single('resume'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) {
      if (req.file.mimetype.includes('pdf')) {
        const parsed = await pdfParse(req.file.buffer);
        text = parsed.text || text;
      } else {
        text = req.file.buffer.toString('utf8');
      }
    }

    text = normalizeText(text);
    const sections = splitSections(text);
    const risks = detectRisks(text);
    const kb = await buildKnowledgeBase(text);

    const outDir = path.resolve(__dirname, '../data');
    await fs.mkdir(outDir, { recursive: true });
    const kbForDisk = kb.map(({ id, content }) => ({ id, content }));
    await fs.writeFile(
      path.join(outDir, 'latest.json'),
      JSON.stringify({ text, sections, risks, kb: kbForDisk }, null, 2)
    );

    res.json({ text, sections, risks, kbSize: kb.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/questions', async (req, res) => {
  try {
    const { text, query } = req.body;
    const kb = await buildKnowledgeBase(text);
    const retrieved = await retrieveTopK(kb, query || text.slice(0, 100), 3);
    const questions = generateQuestions(text, retrieved);
    res.json({ retrieved, questions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rewrite', (req, res) => {
  try {
    const { text } = req.body;
    res.json(rewriteResume(text));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/evaluate', async (req, res) => {
  try {
    const { answer, retrieved = [] } = req.body;
    res.json(await evaluateAnswer(answer || '', retrieved));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ResumePilot server running at http://localhost:${PORT}`);
  getEmbedder().catch((err) => console.error('[embedder] failed to load:', err));
});
