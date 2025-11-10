export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtras } from '@/lib/db';
import { flatten } from '@/lib/flatten';

function parseBool(s: string|undefined) {
  if (s === undefined) return undefined;
  return ['1','true','yes','on'].includes(s.toLowerCase());
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const teamId = url.searchParams.get('teamId') ?? undefined;
  const ownerId = url.searchParams.get('ownerId') ?? undefined;
  const productId = url.searchParams.get('productId') ?? undefined;
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  const sort = url.searchParams.get('sort') ?? undefined;
  const order = (url.searchParams.get('order') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  // Appelle l’API source — adapte le chemin/params selon ta vraie API.
  const source = await upstream(`/subscriptions?` + new URLSearchParams({
    q: q ?? '',
    status: status ?? '',
    teamId: teamId ?? '',
    ownerId: ownerId ?? '',
    productId: productId ?? '',
    from: from ?? '',
    to: to ?? '',
    sort: sort ?? '',
    order,
    limit: String(limit),
    offset: String(offset)
  }).toString());

  // On attend un shape { content: [...], total: number } côté source (adapte si différent)
  const items: any[] = source.content ?? source.items ?? [];
  const ids = items.map(i => i.id).filter(Boolean);
  const extraMap = await selectExtras(ids);

  const flattened = items.map(it => flatten(it, extraMap.get(it.id)));
  const total = Number(source.total ?? source.count ?? flattened.length);

  return NextResponse.json({
    items: flattened,
    total,
    limit,
    offset
  });
}
