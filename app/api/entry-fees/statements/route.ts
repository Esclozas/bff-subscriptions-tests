export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { listStatements } from '@/modules/entryFees/Statements/db';
import { assertValidIssueStatus, assertValidPaymentStatus } from '@/modules/entryFees/Statements/status';

const QuerySchema = z.object({
  payment_list_id: z.string().uuid().optional(),
  issue_status: z.string().optional(),
  payment_status: z.string().optional(),
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

  const issueStatus = q.issue_status ? assertValidIssueStatus(q.issue_status) : null;
  if (q.issue_status && !issueStatus) {
    return withCors(NextResponse.json({ message: 'Invalid issue_status filter' }, { status: 400 }));
  }

  const paymentStatus = q.payment_status ? assertValidPaymentStatus(q.payment_status) : null;
  if (q.payment_status && !paymentStatus) {
    return withCors(NextResponse.json({ message: 'Invalid payment_status filter' }, { status: 400 }));
  }

  const { items, total, nextCursor } = await listStatements({
    paymentListId: q.payment_list_id ?? null,
    issueStatus,
    paymentStatus,
    currency: q.currency ?? null,
    groupKey: q.billing_group_id ?? null,
    limit,
    cursor: q.cursor ?? null,
  });

  const enriched = items.map((item) => {
    const raw = item as any;
    const subscriptions_count =
      typeof raw.subscriptions_count === 'number'
        ? raw.subscriptions_count
        : typeof raw.subscriptionsCount === 'number'
          ? raw.subscriptionsCount
          : null;

    return {
      ...item,
      subscriptions_count,
      subscriptionsCount: subscriptions_count,
    };
  });

  return withCors(NextResponse.json({ items: enriched, total, nextCursor, limit }));

}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
