// app/api/teams/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { upstreamTeams } from '@/lib/http-teams';

/** Lit le cookie upstream (ou token fallback) — identique subscriptions */
function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const cookie = cookieHeaderFrom(req);

    const limit = clampInt(url.searchParams.get('size'), 10, 1, 5000);
    const page = clampInt(url.searchParams.get('page'), 0, 0, 2_000_000_000);
    const offset = page * limit;

    const params = new URLSearchParams({
      page: String(page),
      size: String(limit),
    });

    const data = await upstreamTeams(`/teams?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        // optionnel mais safe si partagé avec subscriptions
        ...(process.env.UPSTREAM_ACCESS_TOKEN
          ? { 'X-jwt': process.env.UPSTREAM_ACCESS_TOKEN }
          : {}),
      },
    });

    const items = Array.isArray((data as any)?.content)
      ? (data as any).content
      : [];

    const total = Number((data as any)?.totalElements ?? items.length);

    return withCors(
      NextResponse.json({
        items,
        total,
        limit,
        offset,
      }),
    );
  } catch (e: any) {
    return withCors(
      NextResponse.json(
        {
          error: true,
          message: e?.message,
          status: e?.status,
          url: e?.url,
          body: e?.body,
        },
        { status: e?.status ?? 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
