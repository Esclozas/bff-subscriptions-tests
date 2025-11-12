export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtras } from '@/lib/db';
import { flatten } from '@/lib/flatten';

type SourceList = { content?: any[]; items?: any[]; total?: number };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const status = url.searchParams.get('status') ?? '';
  const teamId = url.searchParams.get('teamId') ?? '';
  const ownerId = url.searchParams.get('ownerId') ?? '';
  const productId = url.searchParams.get('productId') ?? '';
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const sortField = url.searchParams.get('sort') ?? '';
  const order = (url.searchParams.get('order') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  // Traduction pagination: limit/offset -> size/page (Spring)
  const size = limit > 0 ? limit : 20;
  const page = size > 0 ? Math.floor(offset / size) : 0;

  // Traduction tri: sort + order -> sort=field,order
  const sortParam = sortField ? `${sortField},${order}` : '';

  // Construit la query upstream attendue
  const upstreamParams = new URLSearchParams();
  upstreamParams.set('page', String(page));
  upstreamParams.set('size', String(size));
  if (sortParam) upstreamParams.set('sort', sortParam);

  // On propage les filtres si l’upstream les gère (ajuste si la doc diffère)
  if (q) upstreamParams.set('q', q);
  if (status) upstreamParams.set('status', status);
  if (teamId) upstreamParams.set('teamId', teamId);
  if (ownerId) upstreamParams.set('ownerId', ownerId);
  if (productId) upstreamParams.set('productId', productId);
  if (from) upstreamParams.set('from', from);
  if (to) upstreamParams.set('to', to);

  try {
    const data: SourceList = await upstream(`?${upstreamParams.toString()}`);

    const items = data.content ?? data.items ?? [];
    const ids = items.map(i => i?.id).filter(Boolean);
    const extraMap = await selectExtras(ids);
    const flattened = items.map(it => flatten(it, extraMap.get(it.id)));

    // total upstream si fourni, sinon fallback à la taille retournée
    const total = Number(data.total ?? flattened.length);

    // On renvoie le contrat BFF (limit/offset pour tes clients)
    return NextResponse.json({ items: flattened, total, limit: size, offset: page * size });
  } catch (err: any) {
    const statusCode = err?.status ? 502 : 500;
    return NextResponse.json({
      message: 'Upstream failure on /api/subscriptions',
      upstreamBase: process.env.UPSTREAM_API_BASE_URL ?? 'MISSING',
      path: `?${upstreamParams.toString()}`,
      detail: err?.body ?? String(err),
    }, { status: statusCode });
  }
}
