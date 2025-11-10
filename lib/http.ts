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
    ...(init?.headers || {}),
  };

  const url = `${base}${path}`;
  const res = await fetch(url, { ...init, headers, cache: 'no-store' });

  // Lis la réponse une seule fois
  const text = await res.text().catch(() => '');

  // Essaie de parser JSON, sinon garde le texte brut
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text || undefined;
  }

  if (!res.ok) {
    // Évite ?? + || en même temps → calcule un body d’erreur propre
    const body = (data !== undefined && data !== null && data !== '')
      ? data
      : (text || res.statusText);

    throw new HttpError(res.status, body);
  }

  // Retourne JSON si dispo, sinon objet vide
  return (data ?? {}) as any;
}
