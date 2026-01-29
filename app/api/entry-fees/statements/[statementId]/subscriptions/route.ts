export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getStatement, getStatementLines } from '@/modules/entryFees/Statements/db';
import { loadAllFlattenedSubscriptions } from '@/modules/subscriptions/subscriptions';

type Ctx = { params: Promise<{ statementId: string }> };

function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const s = await getStatement(statementId);
  if (!s) return withCors(NextResponse.json({ message: 'Not Found' }, { status: 404 }));

  const lines = await getStatementLines(statementId);
  if (!lines.length) {
    return withCors(NextResponse.json({ items: [], total: 0 }));
  }

  const cookie = cookieHeaderFrom(req);
  const subscriptions = await loadAllFlattenedSubscriptions(cookie);
  const subscriptionsById = new Map<string, (typeof subscriptions)[number]>();
  for (const sub of subscriptions) {
    if (sub.subscriptionId) {
      subscriptionsById.set(sub.subscriptionId, sub);
    }
  }

  const items = lines.map((line) => {
    const sub = subscriptionsById.get(line.subscription_id) ?? null;
    return {
      id: line.id,
      entry_fees_statement_id: line.entry_fees_statement_id,
      subscription_id: line.subscription_id,
      snapshot_source_group_id: line.snapshot_source_group_id,
      snapshot_total_amount: line.snapshot_total_amount,
      operation_id: sub?.operationId ?? null,
      investor_name: sub?.investorName ?? null,
      investor_first_name: sub?.investorFirstName ?? null,
      fund_name: sub?.fundName ?? null,
      product_name: sub?.productName ?? null,
      team_id: sub?.teamId ?? null,
      team_name: sub?.teamName ?? null,
      part_name: sub?.partName ?? null,
      owner_full_name: sub?.ownerFullName ?? null,
      validation_date: sub?.validationDate ?? null,
      amount_value: sub?.amountValue ?? null,
      amount_currency: sub?.amountCurrency ?? null,
      entry_fees_percent: sub?.entry_fees_percent ?? null,
      entry_fees_amount: sub?.entry_fees_amount ?? null,
      entry_fees_amount_total: sub?.entry_fees_amount_total ?? null,
    };
  });

  return withCors(NextResponse.json({ items, total: items.length }));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
