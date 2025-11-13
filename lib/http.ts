// lib/http.ts
// Client HTTP minimal pour appeler developv4.
// - upstream(path, options): fait un fetch() avec gestion automatique du token
//   et erreurs JSON propres.
// Aucune logique métier ici : seulement un proxy fiable vers l’API developv4.

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

  // Auth & headers optionnels
  const token = process.env.UPSTREAM_API_TOKEN || '';
  const authHeaderName = (process.env.UPSTREAM_AUTH_HEADER || 'Authorization').trim();
  const authScheme = (process.env.UPSTREAM_AUTH_SCHEME || 'Bearer').trim();

  const apiKey = process.env.UPSTREAM_API_KEY || '';
  const clientId = process.env.UPSTREAM_CLIENT_ID || '';
  const tenant = process.env.UPSTREAM_TENANT || '';

  // Construis des en-têtes typés correctement
  const headers = new Headers(init?.headers as HeadersInit | undefined);
  headers.set('Accept', 'application/json');

  if (token) {
    headers.set(authHeaderName, authScheme ? `${authScheme} ${token}` : token);
  }
  if (apiKey) headers.set('X-API-Key', apiKey);
  if (clientId) headers.set('X-Client-Id', clientId);
  if (tenant) headers.set('X-Tenant', tenant);

  const url = `${base}${path}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  const text = await res.text().catch(() => '');
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text || undefined;
  }

  if (!res.ok) {
    const body = (data !== undefined && data !== null && data !== '') ? data : (text || res.statusText);
    const err = new HttpError(res.status, body);
    // Optionnel : attacher l’URL pour le debug
    (err as any).url = url;
    throw err;
  }

  return (data ?? {}) as any;
}
