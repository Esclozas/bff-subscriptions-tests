// lib/http.ts
export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body?: unknown) {
    super(`Upstream error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function upstream(path: string, init?: RequestInit) {
  const base = process.env.UPSTREAM_API_BASE_URL;
  const token = process.env.UPSTREAM_API_TOKEN;

  if (!base) {
    throw new Error('UPSTREAM_API_BASE_URL is not set');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers || {})
  };

  const url = `${base}${path}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  const text = await res.text().catch(() => '');
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new HttpError(res.status, data ?? text || res.statusText);
  }

  return (data ?? {}) as any;
}
