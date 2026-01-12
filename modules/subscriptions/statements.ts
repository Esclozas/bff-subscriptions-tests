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
  statement_status: 'TO_SEND' | 'SENT' | 'PAYED' | 'CANCELLED';
  statement_currency: string;
  statement_payment_list_id: string;
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

/**
 * 1 statement "actif" par subscription_id :
 * - priorité status != CANCELLED
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
    statement_status: StatementInfo['statement_status'];
    statement_currency: string;
    statement_payment_list_id: string;
  };

  const rows = (await sql`
    SELECT DISTINCT ON (ss.subscription_id)
      ss.subscription_id::text as subscription_id,
      s.id::text as statement_id,
      s.statement_number,
      s.status as statement_status,
      s.currency as statement_currency,
      s.entry_fees_payment_list_id::text as statement_payment_list_id
    FROM entry_fees_statement_subscription ss
    JOIN entry_fees_statement s ON s.id = ss.entry_fees_statement_id
    WHERE ss.subscription_id = ANY(${arrayLiteral}::uuid[])
    ORDER BY
      ss.subscription_id,
      (s.status = 'CANCELLED') ASC,
      s.created_at DESC
  `) as unknown as Row[];

  const map = new Map<string, StatementInfo>();
  for (const r of rows) {
    map.set(r.subscription_id, {
      statement_id: r.statement_id,
      statement_number: r.statement_number,
      statement_status: r.statement_status,
      statement_currency: r.statement_currency,
      statement_payment_list_id: r.statement_payment_list_id,
    });
  }

  return map;
}
