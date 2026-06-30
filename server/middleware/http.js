export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requireFields(fields = []) {
  return (req, _res, next) => {
    const missing = fields.filter((field) => {
      const value = req.body?.[field];
      return value === undefined || value === null || (typeof value === 'string' && !value.trim());
    });
    if (missing.length) return next(new HttpError(400, 'VALIDATION_ERROR', `缺少必填字段：${missing.join('、')}`, { missing }));
    next();
  };
}

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, 'NOT_FOUND', `接口不存在：${req.method} ${req.path}`));
}

export function errorHandler(error, _req, res, _next) {
  const status = Number(error?.status) || 500;
  const body = {
    error: error?.message || '服务器内部错误',
    code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR')
  };
  if (error?.details) body.details = error.details;
  res.status(status).json(body);
}
