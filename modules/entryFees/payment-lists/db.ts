import { Pool } from '@neondatabase/serverless';

let _pool: Pool | null = null;
function getPool() {
  if (_pool) return _pool;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function withTx<T>(fn: (client: any) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function q<T = any>(text: string, params: any[] = []) {
  const pool = getPool();
  const res = await pool.query(text, params);
  return res.rows as T[];
}

const T_SUBS = 'public.entry_fees_payment_list_subscription';
const T_TOTAL = 'public.entry_fees_payment_list_total';
const T_EVENT = 'public.entry_fees_payment_list_event';

export type PaymentListRow = {
  id: string;
  created_at: string;
  created_by: string;
  group_structure_id: string;
  period_label: string | null;
  subscriptions_count: number;
  statements_count: number;
};

export type PaymentListTotalRow = {
  id: string;
  entry_fees_payment_list_id: string;
  currency: string;
  total_announced: string;
  statements_count: number;
  subscriptions_count: number;
};

export type PaymentListEventRow = {
  id: string;
  entry_fees_payment_list_id: string;
  currency: string;
  amount_delta: string;
  created_at: string;
  reason: string | null;
  statement_id: string | null;
};

export type StatementAggRow = {
  entry_fees_payment_list_id: string;
  issue_status: string;
  payment_status: string;
  currency: string;
  statements_count: number;
  total_amount: string;
};

export type StatementMinRow = {
  entry_fees_payment_list_id: string;
  id: string;
  issue_status: string;
  payment_status: string;
};

// ✅ listPaymentLists(): statements_count calculé
export async function listPaymentLists(args: {
  from?: string | null;
  to?: string | null;
  created_by?: string | null;
  group_structure_id?: string | null;
  limit: number;
  cursor?: string | null;
}) {
  const pool = getPool();

  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

  const q = `
    SELECT
      pl.id,
      pl.created_at,
      pl.created_by,
      pl.group_structure_id,
      pl.period_label,
      pl.subscriptions_count,
      COUNT(st.id)::int AS statements_count
    FROM public.entry_fees_payment_list pl
    LEFT JOIN public.entry_fees_statement st
      ON st.entry_fees_payment_list_id = pl.id
    WHERE
      ($1::timestamptz IS NULL OR pl.created_at >= $1::timestamptz)
      AND ($2::timestamptz IS NULL OR pl.created_at <= $2::timestamptz)
      AND ($3::text IS NULL OR pl.created_by = $3::text)
      AND ($4::uuid IS NULL OR pl.group_structure_id = $4::uuid)
      AND ($5::timestamptz IS NULL OR pl.created_at < $5::timestamptz)
    GROUP BY pl.id
    ORDER BY pl.created_at DESC
    LIMIT $6
  `;

  const { rows } = await pool.query(q, [
    args.from ?? null,
    args.to ?? null,
    args.created_by ?? null,
    args.group_structure_id ?? null,
    args.cursor ?? null,
    limit,
  ]);

  const nextCursor = rows.length ? rows[rows.length - 1]!.created_at : null;

  return { items: rows as PaymentListRow[], nextCursor };
}

export async function countPaymentLists(args: {
  from?: string | null;
  to?: string | null;
  created_by?: string | null;
  group_structure_id?: string | null;
}) {
  const pool = getPool();
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM public.entry_fees_payment_list pl
    WHERE
      ($1::timestamptz IS NULL OR pl.created_at >= $1::timestamptz)
      AND ($2::timestamptz IS NULL OR pl.created_at <= $2::timestamptz)
      AND ($3::text IS NULL OR pl.created_by = $3::text)
      AND ($4::uuid IS NULL OR pl.group_structure_id = $4::uuid)
  `;

  const { rows } = await pool.query(countQuery, [
    args.from ?? null,
    args.to ?? null,
    args.created_by ?? null,
    args.group_structure_id ?? null,
  ]);

  return Number(rows[0]?.total ?? 0);
}


export async function getPaymentList(id: string) {
  const pool = getPool();

  const q = `
    SELECT
      pl.id,
      pl.created_at,
      pl.created_by,
      pl.group_structure_id,
      pl.period_label,
      pl.subscriptions_count,
      COUNT(st.id)::int AS statements_count
    FROM public.entry_fees_payment_list pl
    LEFT JOIN public.entry_fees_statement st
      ON st.entry_fees_payment_list_id = pl.id
    WHERE pl.id = $1::uuid
    GROUP BY pl.id
    LIMIT 1
  `;

  const { rows } = await pool.query(q, [id]);
  return (rows[0] as PaymentListRow) ?? null;
}


export async function getPaymentListSubscriptions(paymentListId: string) {
  const rows = await q<{ subscription_id: string }>(
    `
    SELECT subscription_id
    FROM ${T_SUBS}
    WHERE entry_fees_payment_list_id = $1::uuid
    ORDER BY subscription_id ASC
    `,
    [paymentListId],
  );

  return rows.map((r) => r.subscription_id);
}

export async function getPaymentListTotals(paymentListId: string) {
  return await q<PaymentListTotalRow>(
    `
    SELECT
      id, entry_fees_payment_list_id, currency, total_announced, statements_count, subscriptions_count
    FROM ${T_TOTAL}
    WHERE entry_fees_payment_list_id = $1::uuid
    ORDER BY currency ASC
    `,
    [paymentListId],
  );
}

export async function getPaymentListEvents(paymentListId: string) {
  return await q<PaymentListEventRow>(
    `
    SELECT
      id,
      entry_fees_payment_list_id,
      currency,
      amount_delta,
      created_at,
      reason,
      statement_id
    FROM ${T_EVENT}
    WHERE entry_fees_payment_list_id = $1::uuid
    ORDER BY created_at DESC
    `,
    [paymentListId],
  );
}

export async function getStatementAggregatesByPaymentListIds(ids: string[]) {
  if (!ids.length) return [] as StatementAggRow[];

  return await q<StatementAggRow>(
    `
    SELECT
      entry_fees_payment_list_id,
      issue_status::text AS issue_status,
      payment_status::text AS payment_status,
      currency,
      COUNT(*)::int AS statements_count,
      COALESCE(SUM(total_amount), 0)::text AS total_amount
    FROM public.entry_fees_statement
    WHERE entry_fees_payment_list_id = ANY($1::uuid[])
    GROUP BY entry_fees_payment_list_id, issue_status, payment_status, currency
    `,
    [ids],
  );
}

export async function getStatementsMinByPaymentListIds(ids: string[]) {
  if (!ids.length) return [] as StatementMinRow[];

  return await q<StatementMinRow>(
    `
    SELECT
      entry_fees_payment_list_id,
      id,
      issue_status::text AS issue_status,
      payment_status::text AS payment_status
    FROM public.entry_fees_statement
    WHERE entry_fees_payment_list_id = ANY($1::uuid[])
    ORDER BY entry_fees_payment_list_id, created_at ASC
    `,
    [ids],
  );
}

export async function insertPaymentListEvent(args: {
  paymentListId: string;
  currency: string;
  amount_delta: string;
  reason?: string | null;
  statement_id?: string | null;
}) {
  const rows = await q<PaymentListEventRow>(
    `
    INSERT INTO ${T_EVENT} (
      entry_fees_payment_list_id, currency, amount_delta, reason, statement_id
    )
    VALUES ($1::uuid, $2::text, $3::numeric, $4::text, $5::uuid)
    RETURNING
      id, entry_fees_payment_list_id, currency, amount_delta, created_at, reason, statement_id
    `,
    [
      args.paymentListId,
      args.currency,
      args.amount_delta,
      args.reason ?? null,
      args.statement_id ?? null,
    ],
  );

  return rows[0] ?? null;
}

export async function createPaymentListAtomicTx(
  client: any,
  args: {
    created_by: string;
    group_structure_id: string;
    period_label?: string | null;
    subscriptions: string[];
    totals: Array<{
      currency: string;
      total_announced: string;
      subscriptions_count?: number | null;
      statements_count?: number | null;
    }>;
  },
) {
  const subscriptions = Array.from(new Set(args.subscriptions));
  if (!subscriptions.length) throw new Error('subscriptions must not be empty');
  if (!args.totals.length) throw new Error('totals must not be empty');

  const totalsJson = JSON.stringify(
    args.totals.map((t) => ({
      currency: t.currency,
      total_announced: t.total_announced,
      statements_count: t.statements_count ?? 0,
      subscriptions_count: t.subscriptions_count ?? subscriptions.length,
    })),
  );

  const qtext = `
    WITH pl AS (
      INSERT INTO public.entry_fees_payment_list (
        created_by, group_structure_id, period_label, subscriptions_count, statements_count
      )
      VALUES ($1, $2::uuid, $3, $4, 0)
      RETURNING id, created_at, created_by, group_structure_id, period_label, subscriptions_count, statements_count
    ),
    ins_subs AS (
      INSERT INTO public.entry_fees_payment_list_subscription (entry_fees_payment_list_id, subscription_id)
      SELECT pl.id, s::uuid
      FROM pl
      CROSS JOIN UNNEST($5::uuid[]) AS s
      RETURNING 1
    ),
    ins_totals AS (
      INSERT INTO public.entry_fees_payment_list_total (
        entry_fees_payment_list_id, currency, total_announced, statements_count, subscriptions_count
      )
      SELECT
        pl.id,
        t.currency,
        (t.total_announced)::numeric,
        t.statements_count,
        t.subscriptions_count
      FROM pl
      CROSS JOIN jsonb_to_recordset($6::jsonb) AS t(
        currency text,
        total_announced text,
        statements_count int,
        subscriptions_count int
      )
      RETURNING 1
    )
    SELECT * FROM pl;
  `;

  const res = await client.query(qtext, [
    args.created_by,
    args.group_structure_id,
    args.period_label ?? null,
    subscriptions.length,
    subscriptions,
    totalsJson,
  ]);

  return res.rows[0] ?? null;
}
