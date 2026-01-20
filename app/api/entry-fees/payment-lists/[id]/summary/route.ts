export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import {
  getPaymentList,
  getPaymentListSubscriptions,
  getPaymentListTotals,
  getPaymentListEvents,
  getStatementAggregatesByPaymentListIds,
} from '@/modules/entryFees/payment-lists/db';
import {
  buildStatementStatsByPaymentList,
  emptyStatementStats,
} from '@/modules/entryFees/payment-lists/statements_stats';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { id } = await context.params;

  const pl = await getPaymentList(id);
  if (!pl) return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));

  const [subs, totals, events, statementAgg] = await Promise.all([
    getPaymentListSubscriptions(id),
    getPaymentListTotals(id),
    getPaymentListEvents(id),
    getStatementAggregatesByPaymentListIds([id]),
  ]);

  const deltaByCur = new Map<string, number>();
  for (const e of events) {
    const delta = Number(e.amount_delta);
    deltaByCur.set(e.currency, (deltaByCur.get(e.currency) ?? 0) + (Number.isFinite(delta) ? delta : 0));
  }

  const totalsSummary = totals.map((t) => {
    const announced = Number(t.total_announced);
    const delta = deltaByCur.get(t.currency) ?? 0;
    const net = (Number.isFinite(announced) ? announced : 0) + delta;

    return {
      currency: t.currency,
      announced_total: t.total_announced,
      net_total: net.toFixed(2),
      events_count: events.filter((e) => e.currency === t.currency).length,
    };
  });

  const statsByList = buildStatementStatsByPaymentList(statementAgg);
  const statements_stats = statsByList.get(id) ?? emptyStatementStats();

  return withCors(
    NextResponse.json({
      paymentList: pl,
      subscriptions_count: subs.length,
      totals: totalsSummary,
      events_count: events.length,
      statements_stats,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
