const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30000;

function extractJsonObject(text = '') {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function resolveBaseUrl() {
  return (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function getLLMConfig() {
  const configured = Boolean(process.env.OPENAI_API_KEY);
  return {
    configured,
    baseUrl: resolveBaseUrl(),
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    mode: configured ? 'live' : 'fallback'
  };
}

export async function callLLMJson({ system, user, schemaHint, fallbackObject }) {
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  if (!process.env.OPENAI_API_KEY) {
    const meta = { mode: 'fallback', model, latencyMs: 0, usage: null, error: null };
    return { object: fallbackObject, mode: 'fallback', meta };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  const startedAt = Date.now();

  try {
    const response = await fetch(`${resolveBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${user}\n\n输出要求：${schemaHint}` }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text();
      const error = `LLM responded ${response.status}: ${detail.slice(0, 200)}`;
      const meta = { mode: 'fallback', model, latencyMs: Date.now() - startedAt, usage: null, error };
      return { object: fallbackObject, mode: 'fallback', error, meta };
    }

    const data = await response.json();
    const outputText = data.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(extractJsonObject(outputText));
    const usage = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? null,
          completionTokens: data.usage.completion_tokens ?? null,
          totalTokens: data.usage.total_tokens ?? null
        }
      : null;
    const meta = { mode: 'live', model: data.model || model, latencyMs: Date.now() - startedAt, usage, error: null };
    return { object: parsed, mode: 'live', raw: data, meta };
  } catch (error) {
    const meta = { mode: 'fallback', model, latencyMs: Date.now() - startedAt, usage: null, error: error.message };
    return { object: fallbackObject, mode: 'fallback', error: error.message, meta };
  } finally {
    clearTimeout(timeout);
  }
}
