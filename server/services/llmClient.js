function extractJsonObject(text = '') {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

export async function callLLMJson({ system, user, schemaHint, fallbackObject }) {
  if (!process.env.OPENAI_API_KEY) {
    return { object: fallbackObject, mode: 'fallback' };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        text: { format: { type: 'json_object' } },
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: `${user}\n\n输出要求：${schemaHint}` }] }
        ]
      })
    });

    const data = await response.json();
    const outputText = data.output_text || '{}';
    const parsed = JSON.parse(extractJsonObject(outputText));
    return { object: parsed, mode: 'openai', raw: data };
  } catch {
    return { object: fallbackObject, mode: 'fallback' };
  }
}
