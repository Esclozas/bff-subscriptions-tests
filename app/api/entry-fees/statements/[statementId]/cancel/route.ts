export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { cancelStatementWithEvent } from '@/modules/entryFees/Statements/db';

type Ctx = { params: Promise<{ statementId: string }> };

const BodySchema = z.object({
  reason: z.string().nullable().optional(),
});

export async function POST(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }));
  }

  const res = await cancelStatementWithEvent(statementId, parsed.data.reason ?? null);

  if (res?.kind === 'NOT_FOUND') {
    return withCors(NextResponse.json({ message: 'Not Found' }, { status: 404 }));
  }
  if (res?.kind === 'ALREADY_CANCELLED') {
    return withCors(NextResponse.json({ message: 'Already cancelled' }, { status: 409 }));
  }
  if (res?.kind !== 'OK') {
    return withCors(NextResponse.json({ message: 'Cancel failed' }, { status: 500 }));
  }

  return withCors(NextResponse.json({ statement: res.statement, event: res.event }));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
