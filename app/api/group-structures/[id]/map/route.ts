export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getGroupStructure, getGroupStructureMap } from '@/modules/grouping/db';

type Ctx = { params: any };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = (await ctx.params) as { id: string };

  const version = await getGroupStructure(id);
  if (!version) {
    return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));
  }

  const mappings = await getGroupStructureMap(id);
  return withCors(NextResponse.json({ group_structure_id: id, mappings }));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
