export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import {
  countPaymentLists,
  getStatementAggregatesByPaymentListIds,
  getStatementsMinByPaymentListIds,
  listPaymentLists,
} from '@/modules/entryFees/payment-lists/db';
import {
  buildStatementStatsByPaymentList,
  emptyStatementStats,
} from '@/modules/entryFees/payment-lists/statements_stats';
import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

type TotalsRow = {
  entry_fees_payment_list_id: string;
  currency: string;
  total_announced: string;
};

type EventsAggRow = {
  entry_fees_payment_list_id: string;
  currency: string;
  events_delta_total: string;
  events_count: number;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // 1) On récupère les lots (déjà paginés)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const cursor = url.searchParams.get('cursor');

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const created_by = url.searchParams.get('created_by');
  const group_structure_id = url.searchParams.get('group_structure_id');
  const includeStatementsMin =
    url.searchParams.get('includeStatementsMin') === 'true' ||
    url.searchParams.get('includeStatementsMin') === '1';

  const [total, { items, nextCursor }] = await Promise.all([
    countPaymentLists({ from, to, created_by, group_structure_id }),
    listPaymentLists({
    from,
    to,
    created_by,
    group_structure_id,
    limit: Number.isFinite(limit) ? limit : 50,
    cursor,
    }),
  ]);

  if (!items.length) {
    return withCors(NextResponse.json({ items: [], nextCursor: null, total }));
  }

  // 2) Charger totals + aggregation events + stats statements pour ces lots
  const sql = getSql();
  const ids = items.map((x) => x.id);

  const totals = (await sql`
    SELECT entry_fees_payment_list_id, currency, total_announced
    FROM public.entry_fees_payment_list_total
    WHERE entry_fees_payment_list_id = ANY(${`{${ids.join(',')}}`}::uuid[])
  `) as unknown as TotalsRow[];

  const eventsAgg = (await sql`
    SELECT
      entry_fees_payment_list_id,
      currency,
      COALESCE(SUM(amount_delta), 0)::text AS events_delta_total,
      COUNT(*)::int AS events_count
    FROM public.entry_fees_payment_list_event
    WHERE entry_fees_payment_list_id = ANY(${`{${ids.join(',')}}`}::uuid[])
    GROUP BY entry_fees_payment_list_id, currency
  `) as unknown as EventsAggRow[];

  const statementAgg = await getStatementAggregatesByPaymentListIds(ids);
  const statsByList = buildStatementStatsByPaymentList(statementAgg);

  const statementsMin = includeStatementsMin ? await getStatementsMinByPaymentListIds(ids) : [];
  const statementsMinByList = new Map<
    string,
    Array<{ id: string; issue_status: string; payment_status: string }>
  >();
  for (const row of statementsMin) {
    const arr = statementsMinByList.get(row.entry_fees_payment_list_id) ?? [];
    arr.push({
      id: row.id,
      issue_status: row.issue_status,
      payment_status: row.payment_status,
    });
    statementsMinByList.set(row.entry_fees_payment_list_id, arr);
  }

  // indexer par (paymentListId -> currency -> ...)
  const totalsByList = new Map<string, TotalsRow[]>();
  for (const t of totals) {
    const arr = totalsByList.get(t.entry_fees_payment_list_id) ?? [];
    arr.push(t);
    totalsByList.set(t.entry_fees_payment_list_id, arr);
  }

  const eventsByListCur = new Map<string, Map<string, EventsAggRow>>();
  for (const e of eventsAgg) {
    const m = eventsByListCur.get(e.entry_fees_payment_list_id) ?? new Map<string, EventsAggRow>();
    m.set(e.currency, e);
    eventsByListCur.set(e.entry_fees_payment_list_id, m);
  }

  // 3) Construire la réponse enrichie
  const enriched = items.map((pl) => {
    const tList = totalsByList.get(pl.id) ?? [];
    const evMap = eventsByListCur.get(pl.id) ?? new Map<string, EventsAggRow>();

    const totalsSummary = tList.map((t) => {
      const ev = evMap.get(t.currency);
      const delta = ev ? Number(ev.events_delta_total) : 0;
      const announced = Number(t.total_announced);
      const net = (Number.isFinite(announced) ? announced : 0) + (Number.isFinite(delta) ? delta : 0);

      return {
        currency: t.currency,
        announced_total: t.total_announced,
        events_delta_total: ev?.events_delta_total ?? '0.00',
        net_total: net.toFixed(2),
        events_count: ev?.events_count ?? 0,
      };
    });

    return {
      ...pl,
      totals: totalsSummary,
      events_count: totalsSummary.reduce((acc, x) => acc + (x.events_count ?? 0), 0),
      statements_stats: statsByList.get(pl.id) ?? emptyStatementStats(),
      ...(includeStatementsMin
        ? { statements_min: statementsMinByList.get(pl.id) ?? [] }
        : {}),
    };
  });

  return withCors(NextResponse.json({ items: enriched, nextCursor, total }));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
