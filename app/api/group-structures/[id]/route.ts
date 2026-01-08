export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getGroupStructure } from '@/modules/grouping/db';

type Ctx = { params: any };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = (await ctx.params) as { id: string };

  const row = await getGroupStructure(id);
  if (!row) {
    return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));
  }
  return withCors(NextResponse.json(row));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
