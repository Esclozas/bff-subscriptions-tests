import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

export type StatementInfo = {
  statement_id: string;
  statement_number: string;
  statement_issue_status: 'ISSUED' | 'CANCELLED';
  statement_payment_status: 'UNPAID' | 'PAID';
  statement_currency: string;
  statement_payment_list_id: string;
};

export type StatementHistoryItem = {
  statement_id: string;
  statement_number: string;
  statement_issue_status: StatementInfo['statement_issue_status'];
  statement_payment_status: StatementInfo['statement_payment_status'];
  statement_currency: string;
  statement_payment_list_id: string;
  statement_group_key: string;
  statement_total_amount: string;
  statement_created_at: string;
  statement_subscription_id: string;
  snapshot_source_group_id: string;
  snapshot_total_amount: string;
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * 1 statement "actif" par subscription_id :
 * - priorité issue_status != CANCELLED
 * - puis plus récent (created_at desc)
 */
export async function selectActiveStatementBySubscriptionIds(subscriptionIds: string[]) {
  const sql = getSql();
  if (!subscriptionIds.length) return new Map<string, StatementInfo>();

  const ids = subscriptionIds.map(String).map(s => s.trim()).filter(isUuid);
  if (!ids.length) return new Map<string, StatementInfo>();

  // même approche que ton db.ts (array literal)
  const arrayLiteral = `{${ids.join(',')}}`;

  type Row = {
    subscription_id: string;
    statement_id: string;
    statement_number: string;
    statement_issue_status: StatementInfo['statement_issue_status'];
    statement_payment_status: StatementInfo['statement_payment_status'];
    statement_currency: string;
    statement_payment_list_id: string;
  };

  const rows = (await sql`
    SELECT DISTINCT ON (ss.subscription_id)
      ss.subscription_id::text as subscription_id,
      s.id::text as statement_id,
      s.statement_number,
      s.issue_status as statement_issue_status,
      s.payment_status as statement_payment_status,
      s.currency as statement_currency,
      s.entry_fees_payment_list_id::text as statement_payment_list_id
    FROM entry_fees_statement_subscription ss
    JOIN entry_fees_statement s ON s.id = ss.entry_fees_statement_id
    WHERE ss.subscription_id = ANY(${arrayLiteral}::uuid[])
    ORDER BY
      ss.subscription_id,
      (s.issue_status = 'CANCELLED') ASC,
      s.created_at DESC
  `) as unknown as Row[];

  const map = new Map<string, StatementInfo>();
  for (const r of rows) {
    map.set(r.subscription_id, {
      statement_id: r.statement_id,
      statement_number: r.statement_number,
      statement_issue_status: r.statement_issue_status,
      statement_payment_status: r.statement_payment_status,
      statement_currency: r.statement_currency,
      statement_payment_list_id: r.statement_payment_list_id,
    });
  }

  return map;
}

export async function listStatementsBySubscriptionId(subscriptionId: string) {
  const sql = getSql();
  if (!isUuid(subscriptionId)) return [];

  type Row = StatementHistoryItem;

  const rows = (await sql`
    SELECT
      s.id::text as statement_id,
      s.statement_number,
      s.issue_status as statement_issue_status,
      s.payment_status as statement_payment_status,
      s.currency as statement_currency,
      s.entry_fees_payment_list_id::text as statement_payment_list_id,
      s.group_key as statement_group_key,
      s.total_amount::text as statement_total_amount,
      s.created_at as statement_created_at,
      ss.id::text as statement_subscription_id,
      ss.snapshot_source_group_id::text as snapshot_source_group_id,
      ss.snapshot_total_amount::text as snapshot_total_amount
    FROM entry_fees_statement_subscription ss
    JOIN entry_fees_statement s ON s.id = ss.entry_fees_statement_id
    WHERE ss.subscription_id = ${subscriptionId}::uuid
    ORDER BY s.created_at DESC, s.id DESC
  `) as unknown as Row[];

  return rows;
}
