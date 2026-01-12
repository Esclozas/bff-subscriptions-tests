// app/api/teams/all/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { loadAllTeams } from '@/modules/teams/teams';

function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

export async function GET(req: NextRequest) {
  try {
    const cookie = cookieHeaderFrom(req);
    const all = await loadAllTeams(cookie);

    return withCors(
      NextResponse.json({
        items: all,
        total: all.length,
        limit: all.length,
        offset: 0,
      }),
    );
  } catch (e: any) {
    return withCors(
      NextResponse.json(
        { error: true, message: e?.message, status: e?.status, url: e?.url, body: e?.body },
        { status: e?.status ?? 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
