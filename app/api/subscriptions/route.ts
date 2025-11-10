export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtras } from '@/lib/db';
import { flatten } from '@/lib/flatten';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const teamId = url.searchParams.get('teamId') ?? '';
  const ownerId = url.searchParams.get('ownerId') ?? '';
  const productId = url.searchParams.get('productId') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const sort = url.searchParams.get('sort') ?? '';
  const order = (url.searchParams.get('order') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  // construit l’URL d’upstream que l’on va appeler (utile pour le debug)
  const qs = new URLSearchParams({
    q, status, teamId, ownerId, productId, from, to, sort, order,
    limit: String(limit), offset: String(offset)
  }).toString();

  try {
    const source = await upstream(`/subscriptions?${qs}`);

    const items: any[] = source.content ?? source.items ?? [];
    const ids = items.map(i => i?.id).filter(Boolean);
    const extraMap = await selectExtras(ids);
    const flattened = items.map(it => flatten(it, extraMap.get(it.id)));
    const total = Number(source.total ?? source.count ?? flattened.length);

    return NextResponse.json({ items: flattened, total, limit, offset });
  } catch (err: any) {
    // log serveur (visible dans Vercel → Deployments → Logs)
    console.error('BFF /api/subscriptions failed', {
      reason: String(err?.message ?? err),
      upstreamBase: process.env.UPSTREAM_API_BASE_URL,
      path: `/subscriptions?${qs}`,
      detail: err?.body ?? null,
      status: err?.status ?? null,
    });

    // réponse lisible côté client
    const status = err?.status ? 502 : 500; // 502 = upstream KO
    return NextResponse.json({
      message: 'Upstream failure on /api/subscriptions',
      upstreamBase: process.env.UPSTREAM_API_BASE_URL ?? 'MISSING',
      path: `/subscriptions?${qs}`,
      detail: err?.body ?? String(err),
    }, { status });
  }
}
