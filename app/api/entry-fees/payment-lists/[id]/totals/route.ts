export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getPaymentList, getPaymentListTotals, getPaymentListEvents } from '@/modules/entryFees/payment-lists/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { id } = await context.params;

  const pl = await getPaymentList(id);
  if (!pl) return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));

  const totals = await getPaymentListTotals(id);
  const events = await getPaymentListEvents(id);

  // sum events by currency (numeric strings -> Number)
  const deltaByCur = new Map<string, number>();
  for (const e of events) {
    const cur = e.currency;
    const delta = Number(e.amount_delta);
    deltaByCur.set(cur, (deltaByCur.get(cur) ?? 0) + (Number.isFinite(delta) ? delta : 0));
  }

  const result = totals.map((t) => {
    const announced = Number(t.total_announced);
    const delta = deltaByCur.get(t.currency) ?? 0;
    const net = (Number.isFinite(announced) ? announced : 0) + delta;

    return {
      currency: t.currency,
      announced_total: t.total_announced,
      events_delta_total: delta.toFixed(2),
      net_total: net.toFixed(2),
      subscriptions_count: t.subscriptions_count,
      statements_count: t.statements_count,
    };
  });

  // currencies présents en events mais absents des totals
  for (const [currency, delta] of deltaByCur.entries()) {
    const exists = totals.some((t) => t.currency === currency);
    if (!exists) {
      result.push({
        currency,
        announced_total: '0',
        events_delta_total: delta.toFixed(2),
        net_total: delta.toFixed(2),
        subscriptions_count: 0,
        statements_count: 0,
      });
    }
  }

  result.sort((a, b) => a.currency.localeCompare(b.currency));

  return withCors(NextResponse.json({ paymentListId: id, items: result }));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
