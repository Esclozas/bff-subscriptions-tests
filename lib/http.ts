export async function upstream(path: string, init?: RequestInit) {
  const base = process.env.UPSTREAM_API_BASE_URL!;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(process.env.UPSTREAM_API_TOKEN ? { Authorization: `Bearer ${process.env.UPSTREAM_API_TOKEN}` } : {}),
    ...(init?.headers || {})
  };
  const res = await fetch(`${base}${path}`, { ...init, headers, cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstream ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}
