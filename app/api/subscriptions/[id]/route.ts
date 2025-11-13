/**
 * Route: GET /api/subscriptions/:id
 *
 * - Recherche la subscription dans l’overview developv4 (pagination interne).
 * - Aplati un seul item avec le même format que la liste.
 * - Merge automatiquement les données Neon via operationId.
 * - Renvoie exactement le même "shape" qu'un item dans /api/subscriptions.
 *
 * Usage:
 *   /api/subscriptions/{subscriptionId}
 *
 * Cette route sert à afficher la page de détails, parfaitement alignée
 * avec la liste (mêmes champs, mêmes noms).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { selectExtrasByOperationId } from '@/lib/db';
import { flattenSubscription } from '@/lib/flatten';

type Ctx = { params: Promise<{ id: string }> };

function cookieHeaderFrom(req: NextRequest) {
  const incomingCookie = req.headers.get('cookie') ?? '';
  if (incomingCookie) return incomingCookie;
  if (process.env.UPSTREAM_ACCESS_TOKEN) return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  return '';
}

async function upstreamOverview(page: number, size: number, cookie: string) {
  const base = process.env.UPSTREAM_API_BASE_URL!;
  const url = `${base}/overview?page=${page}&size=${size}`;
  const payload = {
    status: [],
    partIds: [],
    personTypes: [],
    internal: false,
    timeZone: 'Europe/Paris',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstream ${res.status} ${res.statusText} @ ${url} :: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<{
    content?: any[];
    items?: any[];
    totalElements?: number;
    total?: number;
    totalPages?: number;
    number?: number;
    size?: number;
  }>;
}

export async function GET(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const cookie = cookieHeaderFrom(req);

  try {
    const PAGE_SIZE = 100;
    let page = 0;
    let maxPages = 10;

    let found: any | null = null;

    while (page < maxPages && !found) {
      const data = await upstreamOverview(page, PAGE_SIZE, cookie);
      const list = (Array.isArray(data.content)
        ? data.content
        : Array.isArray(data.items)
        ? data.items
        : []) as any[];

      found =
        list.find(
          (it) => (it?.id ?? it?.subscriptionId ?? it?.subscription?.id) === id,
        ) ?? null;

      const totalPages =
        typeof data.totalPages === 'number'
          ? data.totalPages
          : typeof data.total === 'number' && PAGE_SIZE > 0
          ? Math.ceil(data.total / PAGE_SIZE)
          : null;

      if (totalPages != null) maxPages = Math.min(maxPages, totalPages);
      if (found || list.length < PAGE_SIZE) break;

      page += 1;
    }

    if (!found) {
      return NextResponse.json({ message: 'Not Found in overview', id }, { status: 404 });
    }

    const opId: string | null = found?.operationId ?? found?.operation?.id ?? null;
    let extra: any = null;
    try {
      if (opId) {
        const map = await selectExtrasByOperationId([opId]);
        extra = map.get(opId) ?? null;
      }
    } catch {
      extra = null;
    }

    const flat = flattenSubscription(found, extra);
    return NextResponse.json(flat);
  } catch (err: any) {
    return NextResponse.json(
      { message: 'Detail failure (overview fallback)', detail: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
