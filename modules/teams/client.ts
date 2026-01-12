export type Team = {
  id: string;
  name: string;
};

export async function fetchAllTeamsFromReq(req: Request): Promise<Team[]> {
  const origin = new URL(req.url).origin;

  const res = await fetch(`${origin}/api/teams/all`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch /api/teams/all: ${res.status} ${text}`);
  }

  const data = (await res.json()) as any;

  // Supporte:
  // - [{ id, name }]
  // - { items: [{ id, name }] }
  const items: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.items)
    ? data.items
    : [];

  return items
    .filter((t) => typeof t?.id === 'string')
    .map((t) => ({
      id: t.id,
      name: typeof t?.name === 'string' ? t.name : null,
    }));
}

export function indexTeamsById(teams: Team[]) {
  const map = new Map<string, Team>();
  for (const t of teams) map.set(t.id, t);
  return map;
}
