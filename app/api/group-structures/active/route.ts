export const runtime = 'nodejs';

import { NextResponse, NextRequest } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getActiveGroupStructure } from '@/modules/grouping/db';

export async function GET() {
  const active = await getActiveGroupStructure();
  if (!active) {
    return withCors(NextResponse.json({ message: 'No active group structure' }, { status: 404 }));
  }
  return withCors(NextResponse.json(active));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
