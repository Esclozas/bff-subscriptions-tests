import { neon, Pool } from '@neondatabase/serverless';
import { canTransitionPaymentStatus, type IssueStatus, type PaymentStatus } from './status';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

let _pool: Pool | null = null;
function getPool() {
  if (_pool) return _pool;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

const T_STATEMENT = 'entry_fees_statement';
const T_LINE = 'entry_fees_statement_subscription';
// ⚠️ à adapter si ton event table/colonnes diffèrent
const T_EVENT = 'entry_fees_payment_list_event';

export type StatementRow = {
  id: string;
  entry_fees_payment_list_id: string;
  group_key: string;
  statement_number: string;
  issue_status: IssueStatus;
  payment_status: PaymentStatus;
  currency: string;
  total_amount: string | number;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  subscriptions_count?: number;
};

export type LineRow = {
  id: string;
  entry_fees_statement_id: string;
  subscription_id: string;
  snapshot_source_group_id: string;
  snapshot_total_amount: string | number;
};

export function encodeCursor(obj: any) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
}
export function decodeCursor(cursor: string) {
  const s = Buffer.from(cursor, 'base64').toString('utf8');
  return JSON.parse(s);
}

/** LIST statements avec filtres + pagination limit/cursor (order: created_at desc, id desc) */
export async function listStatements(args: {
  paymentListId?: string | null;
  issueStatus?: IssueStatus | null;
  paymentStatus?: PaymentStatus | null;
  currency?: string | null;
  groupKey?: string | null;
  limit: number;
  cursor?: string | null;
}) {
  const sql = getSql();
  const limit = Math.min(Math.max(args.limit, 1), 200);

  let cursorCreatedAt: string | null = null;
  let cursorId: string | null = null;
  if (args.cursor) {
    const decoded = decodeCursor(args.cursor);
    cursorCreatedAt = decoded?.createdAt ?? null;
    cursorId = decoded?.id ?? null;
  }

  // ✅ On factorise les filtres (réutilisés dans COUNT et SELECT)
  const whereFilters = sql`
    WHERE 1=1
      ${args.paymentListId ? sql`AND entry_fees_payment_list_id = ${args.paymentListId}::uuid` : sql``}
      ${args.issueStatus ? sql`AND issue_status = ${args.issueStatus}::entry_fees_statement_issue_status_enum` : sql``}
      ${args.paymentStatus ? sql`AND payment_status = ${args.paymentStatus}::entry_fees_statement_payment_status_enum` : sql``}
      ${args.currency ? sql`AND currency = ${args.currency}` : sql``}
      ${args.groupKey ? sql`AND group_key = ${args.groupKey}` : sql``}
  `;

  // ✅ total = count(*) sur l’ensemble filtré (sans cursor)
  const countRows = (await sql`
    SELECT COUNT(*)::int AS total
    FROM ${sql.unsafe(T_STATEMENT)}
    ${whereFilters}
  `) as unknown as { total: number }[];

  const total = countRows?.[0]?.total ?? 0;

  // ✅ items = page courante (avec cursor si présent)
  const rows = (await sql`
    SELECT
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      issue_status,
      payment_status,
      currency,
      total_amount,
      created_at,
      paid_at,
      cancelled_at,
      (
        SELECT COUNT(*)::int
        FROM ${sql.unsafe(T_LINE)} ss
        WHERE ss.entry_fees_statement_id = s.id
      ) AS subscriptions_count
    FROM ${sql.unsafe(T_STATEMENT)} s
    ${whereFilters}
    ${
      cursorCreatedAt && cursorId
        ? sql`AND (created_at, id) < (${cursorCreatedAt}::timestamptz, ${cursorId}::uuid)`
        : sql``
    }
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as unknown as StatementRow[];

  const nextCursor =
    rows.length === limit
      ? encodeCursor({ createdAt: rows[rows.length - 1].created_at, id: rows[rows.length - 1].id })
      : null;

  return { items: rows, total, nextCursor };
}


/** GET statement by id */
export async function getStatement(statementId: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      issue_status,
      payment_status,
      currency,
      total_amount,
      created_at,
      paid_at,
      cancelled_at,
      (
        SELECT COUNT(*)::int
        FROM ${sql.unsafe(T_LINE)} ss
        WHERE ss.entry_fees_statement_id = s.id
      ) AS subscriptions_count
    FROM ${sql.unsafe(T_STATEMENT)} s
    WHERE id = ${statementId}::uuid
    LIMIT 1
  `) as unknown as StatementRow[];

  return rows[0] ?? null;
}

/** GET lines by statement id */
export async function getStatementLines(statementId: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT
      id,
      entry_fees_statement_id,
      subscription_id,
      snapshot_source_group_id,
      snapshot_total_amount
    FROM ${sql.unsafe(T_LINE)}
    WHERE entry_fees_statement_id = ${statementId}::uuid
    ORDER BY subscription_id ASC
  `) as unknown as LineRow[];

  return rows;
}

/** PATCH payment_status uniquement */
export async function updateStatementPaymentStatus(statementId: string, newStatus: PaymentStatus) {
  const sql = getSql();
  const rows = (await sql`
    UPDATE ${sql.unsafe(T_STATEMENT)}
    SET payment_status = ${newStatus}::entry_fees_statement_payment_status_enum
      , paid_at = CASE
          WHEN ${newStatus}::entry_fees_statement_payment_status_enum = 'PAID'::entry_fees_statement_payment_status_enum
            THEN NOW()
          ELSE NULL
        END
    WHERE id = ${statementId}::uuid
    RETURNING
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      issue_status,
      payment_status,
      currency,
      total_amount,
      created_at,
      paid_at,
      cancelled_at,
      (
        SELECT COUNT(*)::int
        FROM ${sql.unsafe(T_LINE)} ss
        WHERE ss.entry_fees_statement_id = id
      ) AS subscriptions_count
  `) as unknown as StatementRow[];
  return rows[0] ?? null;
}

export async function updateStatementsPaymentStatusBatch(
  updates: Array<{ id: string; payment_status: PaymentStatus }>,
) {
  if (!updates.length) return [];
  const pool = getPool();
  const client = await pool.connect();

  const selectSql = `
    SELECT
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      issue_status,
      payment_status,
      currency,
      total_amount,
      created_at,
      paid_at,
      cancelled_at,
      (
        SELECT COUNT(*)::int
        FROM ${T_LINE} ss
        WHERE ss.entry_fees_statement_id = s.id
      ) AS subscriptions_count
    FROM ${T_STATEMENT} s
    WHERE id = $1::uuid
    FOR UPDATE
    LIMIT 1
  `;

  const updateSql = `
    UPDATE ${T_STATEMENT}
    SET payment_status = $2::entry_fees_statement_payment_status_enum
      , paid_at = CASE
          WHEN $2::entry_fees_statement_payment_status_enum = 'PAID'::entry_fees_statement_payment_status_enum
            THEN NOW()
          ELSE NULL
        END
    WHERE id = $1::uuid
    RETURNING
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      issue_status,
      payment_status,
      currency,
      total_amount,
      created_at,
      paid_at,
      cancelled_at,
      (
        SELECT COUNT(*)::int
        FROM ${T_LINE} ss
        WHERE ss.entry_fees_statement_id = id
      ) AS subscriptions_count
  `;

  try {
    await client.query('BEGIN');
    const results: StatementRow[] = [];

    for (let i = 0; i < updates.length; i += 1) {
      const { id, payment_status } = updates[i];

      const sRows = (await client.query(selectSql, [id])).rows as StatementRow[];
      const s = sRows[0] ?? null;
      if (!s) {
        const err: any = new Error('STATEMENT_NOT_FOUND');
        err.code = 'STATEMENT_NOT_FOUND';
        err._batch = { op: 'update', index: i, id };
        throw err;
      }

      if (s.payment_status === payment_status) {
        results.push(s);
        continue;
      }

      if (!canTransitionPaymentStatus(s.payment_status, payment_status)) {
        const err: any = new Error('INVALID_TRANSITION');
        err.code = 'INVALID_TRANSITION';
        err._batch = { op: 'update', index: i, id, from: s.payment_status, to: payment_status };
        throw err;
      }

      const updatedRows = (await client.query(updateSql, [id, payment_status])).rows as StatementRow[];
      results.push(updatedRows[0]);
    }

    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * CANCEL = transaction:
 *  - lock statement row
 *  - if already CANCELLED => conflict
 *  - update issue_status=CANCELLED
 *  - insert event delta négatif sur payment list
 *
 * ⚠️ IMPORTANT: la table event n’est pas décrite ici.
 * -> Tu devras ajuster les colonnes exactes.
 */
export async function cancelStatementWithEvent(statementId: string, reason?: string | null) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const sRows = await client.query<StatementRow>(
      `
      SELECT
        id,
        entry_fees_payment_list_id,
        group_key,
        statement_number,
        issue_status,
        payment_status,
        currency,
        total_amount,
        created_at,
        paid_at,
        cancelled_at,
        (
          SELECT COUNT(*)::int
          FROM ${T_LINE} ss
          WHERE ss.entry_fees_statement_id = s.id
        ) AS subscriptions_count
      FROM ${T_STATEMENT} s
      WHERE id = $1::uuid
      FOR UPDATE
      LIMIT 1
      `,
      [statementId],
    );

    const s = sRows.rows[0] ?? null;
    if (!s) {
      await client.query('ROLLBACK');
      return { kind: 'NOT_FOUND' as const };
    }

    if (s.issue_status === 'CANCELLED') {
      await client.query('ROLLBACK');
      return { kind: 'ALREADY_CANCELLED' as const };
    }

    const updatedRows = await client.query<StatementRow>(
      `
      UPDATE ${T_STATEMENT}
      SET issue_status = 'CANCELLED'::entry_fees_statement_issue_status_enum,
          cancelled_at = NOW()
      WHERE id = $1::uuid
      RETURNING
        id,
        entry_fees_payment_list_id,
        group_key,
        statement_number,
        issue_status,
        payment_status,
        currency,
        total_amount,
        created_at,
        paid_at,
        cancelled_at,
        (
          SELECT COUNT(*)::int
          FROM ${T_LINE} ss
          WHERE ss.entry_fees_statement_id = $1::uuid
        ) AS subscriptions_count
      `,
      [statementId],
    );

    const updated = updatedRows.rows[0];

    // Insert event (delta négatif)
    // ⚠️ adapte ces colonnes selon ton schéma réel
    const eRows = await client.query<{ id: string }>(
      `
      INSERT INTO ${T_EVENT} (
        entry_fees_payment_list_id,
        currency,
        amount_delta,
        statement_id,
        reason
      )
      VALUES ($1::uuid, $2, $3, $4::uuid, $5)
      RETURNING id
      `,
      [
        updated.entry_fees_payment_list_id,
        updated.currency,
        Number(updated.total_amount) * -1,
        updated.id,
        reason ?? null,
      ],
    );

    await client.query('COMMIT');
    return { kind: 'OK' as const, statement: updated, event: eRows.rows[0] ?? null };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
