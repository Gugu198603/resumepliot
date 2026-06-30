export function corsOptionsFromEnv() {
  const configured = String(process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!configured.length) return { origin: true, credentials: false };
  const allowed = new Set(configured);
  return {
    origin(origin, callback) {
      if (!origin || allowed.has(origin)) return callback(null, true);
      callback(new Error('Origin is not allowed by CORS policy.'));
    },
    credentials: true
  };
}

export function basicSecurityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
  next();
}

export function apiTokenAuth(req, res, next) {
  const expected = process.env.APP_API_TOKEN;
  if (!expected || req.path === '/api/health') return next();
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token === expected) return next();
  res.status(401).json({ error: '未授权访问。', code: 'UNAUTHORIZED' });
}

export function createRateLimit({ windowMs = 60_000, max = 120 } = {}) {
  const clients = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const current = clients.get(key);
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    entry.count += 1;
    clients.set(key, entry);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) return res.status(429).json({ error: '请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' });
    if (clients.size > 5000) {
      for (const [client, value] of clients) if (value.resetAt <= now) clients.delete(client);
    }
    next();
  };
}
