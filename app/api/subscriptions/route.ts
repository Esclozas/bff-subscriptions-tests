/**
 * Route: GET /api/subscriptions
 *
 * - Récupère la liste des subscriptions depuis developv4 (/overview).
 * - Aplatit chaque item (format unique BFF).
 * - Merge automatiquement les données Neon via operationId.
 * - Renvoie un JSON: { items, total, limit, offset }.
 *
 * Usage:
 *   /api/subscriptions?status=TO_BE_SENT&limit=20
 *   /api/subscriptions?sort=createdDate&order=desc
 *   /api/subscriptions?raw=1     → renvoie la réponse brute developv4
 *
 * Cette route est optimisée pour les tableaux (list page).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtrasByOperationId } from '@/lib/db';
import { flattenSubscription } from '@/lib/flatten';

type SourceList = {
  content?: any[];
  items?: any[];
  total?: number;
  totalElements?: number;
};

function cookieHeaderFrom(req: NextRequest) {
  const incomingCookie = req.headers.get('cookie') ?? '';
  if (incomingCookie) return incomingCookie;
  if (process.env.UPSTREAM_ACCESS_TOKEN) return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  return '';
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const order = (url.searchParams.get('order') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  const size = limit > 0 ? limit : 20;
  const page = size > 0 ? Math.floor(offset / size) : 0;

  const sortField = url.searchParams.get('sort') ?? '';
  const sortParam = sortField ? `${sortField},${order}` : '';

  const upstreamParams = new URLSearchParams({ page: String(page), size: String(size) });
  if (sortParam) upstreamParams.set('sort', sortParam);

  const payload = {
    status: (url.searchParams.get('status') ?? '') ? [String(url.searchParams.get('status'))] : [],
    partIds: [],
    personTypes: [],
    internal: false,
    timeZone: 'Europe/Paris',
  };

  const cookieHeader = cookieHeaderFrom(req);

  try {
    const data: SourceList = await upstream(`/overview?${upstreamParams.toString()}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      body: JSON.stringify(payload),
    });

    // Debug brut si besoin
    if (url.searchParams.get('raw') === '1') {
      return NextResponse.json(data);
    }

    const items = (Array.isArray((data as any).content)
      ? (data as any).content
      : Array.isArray((data as any).items)
      ? (data as any).items
      : []) as any[];

    // Collecte des operationId (clé de jointure TEXT côté Neon)
    const opIds = items
      .map((it) => it?.operationId ?? it?.operation?.id ?? null)
      .filter(Boolean) as string[];

    // Chargement des extras Neon (tolérer l’échec DB)
    let extras = new Map<string, any>();
    try {
      if (opIds.length) {
        extras = await selectExtrasByOperationId(opIds);
      }
    } catch {
      extras = new Map();
    }

    // Aplatis + merge (contrat final pour l’UI)
    const flattened = items.map((it) => {
      const opId = it?.operationId ?? it?.operation?.id ?? '';
      const extra = opId ? extras.get(opId) ?? null : null;
      return flattenSubscription(it, extra);
    });

    const total = Number(
      (data as any).total ?? (data as any).totalElements ?? flattened.length,
    );

    return NextResponse.json({
      items: flattened,
      total,
      limit: size,
      offset: page * size,
    });
  } catch (err: any) {
    const statusCode = err?.status ? 502 : 500;
    return NextResponse.json(
      {
        message: 'Upstream failure on /api/subscriptions',
        upstreamBase: process.env.UPSTREAM_API_BASE_URL ?? 'MISSING',
        detail: err?.body ?? String(err),
      },
      { status: statusCode },
    );
  }
}
