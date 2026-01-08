export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { activateGroupStructure } from '@/modules/grouping/db';

type Ctx = { params: any };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = (await ctx.params) as { id: string };

  try {
    const res = await activateGroupStructure(id);
    if (!res.ok) {
      return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));
    }
    return withCors(NextResponse.json({ id, is_active: true }));
  } catch (err: any) {
    const code = err?._pgcode ?? err?.code ?? null;
    if (code === '23505') {
      return withCors(
        NextResponse.json(
          { message: 'Conflict', detail: 'Activation conflict (unique active constraint).', code },
          { status: 409 },
        ),
      );
    }
    return withCors(
      NextResponse.json(
        { message: 'DB failure on activate', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
