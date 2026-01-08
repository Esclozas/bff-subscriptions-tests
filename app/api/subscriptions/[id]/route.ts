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
import { selectExtrasByOperationId } from '@/modules/subscriptions/db';
import { flattenSubscription } from '@/modules/subscriptions/flatten';
import { withCors, handleOptions } from '@/lib/cors'; // 👈 import CORS
import { upstream } from '@/lib/http';


type Ctx = { params: Promise<{ id: string }> };

function cookieHeaderFrom(req: NextRequest) {
  const incomingCookie = req.headers.get('cookie') ?? '';
  if (incomingCookie) return incomingCookie;
  if (process.env.UPSTREAM_ACCESS_TOKEN) return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  return '';
}

async function upstreamOverview(page: number, size: number, cookie: string) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  });

  const payload = {
    status: [],
    partIds: [],
    personTypes: [],
    internal: false,
    timeZone: 'Europe/Paris',
  };

  const data = await upstream(`/overview?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-jwt': process.env.UPSTREAM_ACCESS_TOKEN || '',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });

  return data as {
    content?: any[];
    items?: any[];
    totalElements?: number;
    total?: number;
    totalPages?: number;
    number?: number;
    size?: number;
  };
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
      return withCors(
        NextResponse.json({ message: 'Not Found in overview', id }, { status: 404 }),
      ); // 👈 CORS ici
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
    return withCors(NextResponse.json(flat)); // 👈 succès avec CORS
  } catch (err: any) {
    return withCors(
      NextResponse.json(
        {
          message: 'Detail failure (overview fallback)',
          detail: String(err?.message ?? err),
        },
        { status: 500 },
      ),
    ); // 👈 erreur avec CORS
  }
}

// 👇 Handler OPTIONS pour le préflight CORS
export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}