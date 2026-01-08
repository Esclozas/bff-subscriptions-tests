import { neon } from '@neondatabase/serverless';
import type { StatementStatus } from './status';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
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
  status: StatementStatus;
  currency: string;
  total_amount: string | number;
  created_at: string;
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
  status?: StatementStatus | null;
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
      ${args.status ? sql`AND status = ${args.status}::entry_fees_statement_status_enum` : sql``}
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
      status,
      currency,
      total_amount,
      created_at
    FROM ${sql.unsafe(T_STATEMENT)}
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
      status,
      currency,
      total_amount,
      created_at
    FROM ${sql.unsafe(T_STATEMENT)}
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

/** PATCH status uniquement */
export async function updateStatementStatus(statementId: string, newStatus: StatementStatus) {
  const sql = getSql();
  const rows = (await sql`
    UPDATE ${sql.unsafe(T_STATEMENT)}
    SET status = ${newStatus}::entry_fees_statement_status_enum
    WHERE id = ${statementId}::uuid
    RETURNING
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      status,
      currency,
      total_amount,
      created_at
  `) as unknown as StatementRow[];
  return rows[0] ?? null;
}

/**
 * CANCEL = transaction:
 *  - lock statement row
 *  - if already CANCELLED => conflict
 *  - update status=CANCELLED
 *  - insert event delta négatif sur payment list
 *
 * ⚠️ IMPORTANT: la table event n’est pas décrite ici.
 * -> Tu devras ajuster les colonnes exactes.
 */
export async function cancelStatementWithEvent(statementId: string, reason?: string | null) {
  const sql = getSql();

  // neon serverless supporte `sql.begin(...)`
  // https://github.com/neondatabase/serverless (pattern: sql.begin(async (tx)=>...))
  const result = await (sql as any).begin(async (tx: any) => {
    const sRows = (await tx`
      SELECT
        id,
        entry_fees_payment_list_id,
        group_key,
        statement_number,
        status,
        currency,
        total_amount,
        created_at
      FROM ${tx.unsafe(T_STATEMENT)}
      WHERE id = ${statementId}::uuid
      FOR UPDATE
      LIMIT 1
    `) as unknown as StatementRow[];

    const s = sRows[0] ?? null;
    if (!s) return { kind: 'NOT_FOUND' as const };

    if (s.status === 'CANCELLED') return { kind: 'ALREADY_CANCELLED' as const };

    const updatedRows = (await tx`
      UPDATE ${tx.unsafe(T_STATEMENT)}
      SET status = 'CANCELLED'::entry_fees_statement_status_enum
      WHERE id = ${statementId}::uuid
      RETURNING
        id,
        entry_fees_payment_list_id,
        group_key,
        statement_number,
        status,
        currency,
        total_amount,
        created_at
    `) as unknown as StatementRow[];

    const updated = updatedRows[0];

    // Insert event (delta négatif)
    // ⚠️ adapte ces colonnes selon ton schéma réel
    const eRows = (await tx`
      INSERT INTO ${tx.unsafe(T_EVENT)} (
        entry_fees_payment_list_id,
        currency,
        amount_delta,
        statement_id,
        reason
      )
      VALUES (
        ${updated.entry_fees_payment_list_id}::uuid,
        ${updated.currency},
        ${Number(updated.total_amount) * -1},
        ${updated.id}::uuid,
        ${reason ?? null}
      )
      RETURNING id
    `) as unknown as { id: string }[];

    return { kind: 'OK' as const, statement: updated, event: eRows[0] ?? null };
  });

  return result;
}
