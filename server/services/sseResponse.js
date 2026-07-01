export function createSseChannel(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.socket?.setNoDelay?.(true);
  res.flushHeaders?.();
  res.write(': connected\n\n');

  let closed = false;
  res.on('close', () => { closed = true; });
  return {
    get closed() { return closed; },
    send(event, data = {}) {
      if (closed) return;
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.flush?.();
    },
    end() {
      if (!closed) res.end();
    }
  };
}
