export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error || `Request failed with status ${response.status}`, response.status, data.code, data.details);
  }
  return data as T;
}

export function getJson<T>(path: string) {
  return requestJson<T>(path);
}

export function sendJson<T>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  return requestJson<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
