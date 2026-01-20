import type { StatementAggRow } from './db';

export type StatementAmountRow = {
  currency: string;
  amount: string;
};

export type StatementStats = {
  total_count: number;
  issued_count: number;
  cancelled_count: number;
  issued_paid_count: number;
  issued_unpaid_count: number;
  cancelled_paid_count: number;
  cancelled_unpaid_count: number;
  total_amounts: StatementAmountRow[];
  issued_amounts: StatementAmountRow[];
  cancelled_amounts: StatementAmountRow[];
  issued_paid_amounts: StatementAmountRow[];
  issued_unpaid_amounts: StatementAmountRow[];
  cancelled_paid_amounts: StatementAmountRow[];
  cancelled_unpaid_amounts: StatementAmountRow[];
};

type AmountMap = Map<string, number>;

type InternalStats = {
  total_count: number;
  issued_count: number;
  cancelled_count: number;
  issued_paid_count: number;
  issued_unpaid_count: number;
  cancelled_paid_count: number;
  cancelled_unpaid_count: number;
  total_amounts: AmountMap;
  issued_amounts: AmountMap;
  cancelled_amounts: AmountMap;
  issued_paid_amounts: AmountMap;
  issued_unpaid_amounts: AmountMap;
  cancelled_paid_amounts: AmountMap;
  cancelled_unpaid_amounts: AmountMap;
};

function newAmountMap(): AmountMap {
  return new Map<string, number>();
}

function createInternalStats(): InternalStats {
  return {
    total_count: 0,
    issued_count: 0,
    cancelled_count: 0,
    issued_paid_count: 0,
    issued_unpaid_count: 0,
    cancelled_paid_count: 0,
    cancelled_unpaid_count: 0,
    total_amounts: newAmountMap(),
    issued_amounts: newAmountMap(),
    cancelled_amounts: newAmountMap(),
    issued_paid_amounts: newAmountMap(),
    issued_unpaid_amounts: newAmountMap(),
    cancelled_paid_amounts: newAmountMap(),
    cancelled_unpaid_amounts: newAmountMap(),
  };
}

function addAmount(map: AmountMap, currency: string, amount: number) {
  const next = (map.get(currency) ?? 0) + (Number.isFinite(amount) ? amount : 0);
  map.set(currency, next);
}

function toAmountList(map: AmountMap): StatementAmountRow[] {
  return Array.from(map.entries())
    .map(([currency, amount]) => ({ currency, amount: amount.toFixed(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export function emptyStatementStats(): StatementStats {
  return {
    total_count: 0,
    issued_count: 0,
    cancelled_count: 0,
    issued_paid_count: 0,
    issued_unpaid_count: 0,
    cancelled_paid_count: 0,
    cancelled_unpaid_count: 0,
    total_amounts: [],
    issued_amounts: [],
    cancelled_amounts: [],
    issued_paid_amounts: [],
    issued_unpaid_amounts: [],
    cancelled_paid_amounts: [],
    cancelled_unpaid_amounts: [],
  };
}

export function buildStatementStatsByPaymentList(rows: StatementAggRow[]) {
  const statsByList = new Map<string, InternalStats>();

  for (const row of rows) {
    const listId = row.entry_fees_payment_list_id;
    const stats = statsByList.get(listId) ?? createInternalStats();
    statsByList.set(listId, stats);

    const count = Number(row.statements_count ?? 0);
    const amount = Number(row.total_amount ?? 0);
    const issue = row.issue_status;
    const payment = row.payment_status;
    const currency = row.currency;

    stats.total_count += count;
    addAmount(stats.total_amounts, currency, amount);

    if (issue === 'ISSUED') {
      stats.issued_count += count;
      addAmount(stats.issued_amounts, currency, amount);

      if (payment === 'PAID') {
        stats.issued_paid_count += count;
        addAmount(stats.issued_paid_amounts, currency, amount);
      } else if (payment === 'UNPAID') {
        stats.issued_unpaid_count += count;
        addAmount(stats.issued_unpaid_amounts, currency, amount);
      }
    } else if (issue === 'CANCELLED') {
      stats.cancelled_count += count;
      addAmount(stats.cancelled_amounts, currency, amount);

      if (payment === 'PAID') {
        stats.cancelled_paid_count += count;
        addAmount(stats.cancelled_paid_amounts, currency, amount);
      } else if (payment === 'UNPAID') {
        stats.cancelled_unpaid_count += count;
        addAmount(stats.cancelled_unpaid_amounts, currency, amount);
      }
    }
  }

  const result = new Map<string, StatementStats>();
  for (const [listId, s] of statsByList) {
    result.set(listId, {
      total_count: s.total_count,
      issued_count: s.issued_count,
      cancelled_count: s.cancelled_count,
      issued_paid_count: s.issued_paid_count,
      issued_unpaid_count: s.issued_unpaid_count,
      cancelled_paid_count: s.cancelled_paid_count,
      cancelled_unpaid_count: s.cancelled_unpaid_count,
      total_amounts: toAmountList(s.total_amounts),
      issued_amounts: toAmountList(s.issued_amounts),
      cancelled_amounts: toAmountList(s.cancelled_amounts),
      issued_paid_amounts: toAmountList(s.issued_paid_amounts),
      issued_unpaid_amounts: toAmountList(s.issued_unpaid_amounts),
      cancelled_paid_amounts: toAmountList(s.cancelled_paid_amounts),
      cancelled_unpaid_amounts: toAmountList(s.cancelled_unpaid_amounts),
    });
  }

  return result;
}
