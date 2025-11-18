import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { loadAllFlattenedSubscriptions } from '@/lib/subscriptions';

export const runtime = 'nodejs';

function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

export async function GET(req: NextRequest) {
  const cookie = cookieHeaderFrom(req);

  const all = await loadAllFlattenedSubscriptions(cookie);

  return withCors(
    NextResponse.json({
      items: all,
      total: all.length,
      limit: all.length,
      offset: 0,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
