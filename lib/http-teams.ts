// lib/http-teams.ts
import { HttpError } from './http';

export async function upstreamTeams(path: string, init?: RequestInit) {
  const base = process.env.UPSTREAM_TEAMS_BASE_URL;
  if (!base) throw new Error('UPSTREAM_TEAMS_BASE_URL is not set');

  const headers = new Headers(init?.headers as HeadersInit | undefined);
  headers.set('Accept', 'application/json');

  const token = process.env.UPSTREAM_API_TOKEN || '';
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });

  const text = await res.text().catch(() => '');
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const err = new HttpError(res.status, data ?? text);
    (err as any).url = `${base}${path}`;
    throw err;
  }

  return data;
}
