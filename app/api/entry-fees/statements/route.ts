export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { listStatements } from '@/modules/entryFees/Statements/db';
import { assertValidStatus } from '@/modules/entryFees/Statements/status';

const QuerySchema = z.object({
  payment_list_id: z.string().uuid().optional(),
  status: z.string().optional(),
  currency: z.string().optional(),
  billing_group_id: z.string().optional(), // tu l'appelles group_key en DB
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return withCors(NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }));
  }

  const q = parsed.data;
  const limit = Math.min(Math.max(Number(q.limit ?? '50'), 1), 200);

  const status = q.status ? assertValidStatus(q.status) : null;
  if (q.status && !status) {
    return withCors(NextResponse.json({ message: 'Invalid status filter' }, { status: 400 }));
  }

    const { items, total, nextCursor } = await listStatements({
    paymentListId: q.payment_list_id ?? null,
    status,
    currency: q.currency ?? null,
    groupKey: q.billing_group_id ?? null,
    limit,
    cursor: q.cursor ?? null,
    });

    return withCors(NextResponse.json({ items, total, nextCursor, limit }));

}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
