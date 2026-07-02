import path from 'path';
import { pipeline, env } from '@huggingface/transformers';
import { fileURLToPath } from 'url';
import { normalizeText } from './resumeParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

env.cacheDir = path.resolve(__dirname, '../../.hf-cache');
env.allowLocalModels = true;
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com';

const EMBED_MODEL = process.env.EMBED_MODEL || 'Xenova/bge-m3';
let embedderPromise = null;

function getEmbedder() {
  if (!embedderPromise) {
    console.error(`[embedder] loading ${EMBED_MODEL}...`);
    embedderPromise = pipeline('feature-extraction', EMBED_MODEL, { quantized: true });
  }
  return embedderPromise;
}

export function chunkText(text, chunkSize = 220) {
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

export async function embedBatch(texts) {
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

export async function embedOne(text) {
  const [vector] = await embedBatch([text]);
  return vector;
}

export function similarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
