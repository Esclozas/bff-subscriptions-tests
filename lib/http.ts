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
  if (!base) throw new Error('UPSTREAM_API_BASE_URL is not set');

  const token = process.env.UPSTREAM_API_TOKEN || '';
  const authHeaderName = (process.env.UPSTREAM_AUTH_HEADER || 'Authorization').trim();
  const authScheme = (process.env.UPSTREAM_AUTH_SCHEME || 'Bearer').trim();

  const apiKey = process.env.UPSTREAM_API_KEY || '';
  const clientId = process.env.UPSTREAM_CLIENT_ID || '';
  const tenant = process.env.UPSTREAM_TENANT || '';

  const headers: HeadersInit = {
    Accept: 'application/json',
    ...(init?.headers || {}),
  };

  if (token) {
    headers[authHeaderName] = authScheme ? `${authScheme} ${token}` : token;
  }
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (clientId) headers['X-Client-Id'] = clientId;
  if (tenant) headers['X-Tenant'] = tenant;

  const url = `${base}${path}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  const text = await res.text().catch(() => '');
  let data: unknown = undefined;
  try { data = text ? JSON.parse(text) : undefined; } catch { data = text || undefined; }

  if (!res.ok) {
    const body = (data !== undefined && data !== null && data !== '') ? data : (text || res.statusText);
    throw new HttpError(res.status, body);
  }
  return (data ?? {}) as any;
}
