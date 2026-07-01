export interface SseMessage<T = Record<string, unknown>> {
  event: string;
  data: T;
}

export async function streamJsonEvents<TPayload>(
  path: string,
  payload: TPayload,
  onMessage: (message: SseMessage) => void
) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `流式请求失败（${response.status}）。`);
  }
  if (!response.body) throw new Error('当前浏览器不支持流式读取。');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consumeBlock = (block: string) => {
    const eventLine = block.split('\n').find((line) => line.startsWith('event:'));
    const dataLines = block.split('\n').filter((line) => line.startsWith('data:'));
    const event = eventLine?.replace(/^event:\s*/, '').trim() || 'message';
    const raw = dataLines.map((line) => line.replace(/^data:\s?/, '')).join('\n');
    if (raw) onMessage({ event, data: JSON.parse(raw) });
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    blocks.filter(Boolean).forEach(consumeBlock);
  }
  if (buffer.trim()) consumeBlock(buffer.trim());
}
