import { Pool } from '@neondatabase/serverless';

let _pool: Pool | null = null;

function getPool() {
  if (_pool) return _pool;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

export async function createStatementsAndLinesTx(
  client: any,
  args: {
    paymentListId: string;
    snapshotSourceGroupId: string;
    statements: Array<{
      group_key: string;
      currency: string;
      statement_number: string;
      total_amount: string;
    }>;
    lines: Array<{
      subscription_id: string;
      currency: string;
      group_key: string;
      snapshot_total_amount: string;
    }>;
  },
) {
  // Idempotence: si statements existent déjà, on renvoie ceux existants
  const existing = await client.query(
    `SELECT *
     FROM public.entry_fees_statement
     WHERE entry_fees_payment_list_id = $1::uuid
     ORDER BY created_at ASC`,
    [args.paymentListId],
  );

  if (existing.rows.length > 0) {
    return {
      created: 0,
      items: existing.rows,
      message: 'Statements already generated for this payment list',
    };
  }

  const statementsJson = JSON.stringify(args.statements);

  const insertStatements = await client.query(
    `
    WITH ins AS (
      INSERT INTO public.entry_fees_statement (
        entry_fees_payment_list_id,
        group_key,
        statement_number,
        currency,
        total_amount
      )
      SELECT
        $1::uuid,
        s.group_key,
        s.statement_number,
        s.currency,
        (s.total_amount)::numeric
      FROM jsonb_to_recordset($2::jsonb) AS s(
        group_key text,
        statement_number text,
        currency text,
        total_amount text
      )
      RETURNING *
    )
    SELECT * FROM ins
    ORDER BY created_at ASC;
    `,
    [args.paymentListId, statementsJson],
  );

  const createdStatements = insertStatements.rows;

  // map (group_key, currency) -> statement_id
  const statementIdByKey = new Map<string, string>();
  for (const st of createdStatements) {
    statementIdByKey.set(`${st.group_key}__${st.currency}`, st.id);
  }

  const enrichedLines = args.lines.map((l) => {
    const sid = statementIdByKey.get(`${l.group_key}__${l.currency}`);
    if (!sid) {
      throw new Error(
        `DB_FAILURE_STATEMENT_NOT_FOUND_FOR_LINE group_key=${l.group_key} currency=${l.currency}`,
      );
    }
    return {
      entry_fees_statement_id: sid,
      subscription_id: l.subscription_id,
      snapshot_source_group_id: args.snapshotSourceGroupId,
      snapshot_total_amount: l.snapshot_total_amount,
    };
  });

  const enrichedJson = JSON.stringify(enrichedLines);

  await client.query(
    `
    INSERT INTO public.entry_fees_statement_subscription (
      entry_fees_statement_id,
      subscription_id,
      snapshot_source_group_id,
      snapshot_total_amount
    )
    SELECT
      l.entry_fees_statement_id::uuid,
      l.subscription_id::uuid,
      l.snapshot_source_group_id::uuid,
      (l.snapshot_total_amount)::numeric
    FROM jsonb_to_recordset($1::jsonb) AS l(
      entry_fees_statement_id text,
      subscription_id text,
      snapshot_source_group_id text,
      snapshot_total_amount text
    )
    `,
    [enrichedJson],
  );

  return { created: createdStatements.length, items: createdStatements };
}

export async function listStatementsByPaymentListId(paymentListId: string) {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      id,
      entry_fees_payment_list_id,
      group_key,
      statement_number,
      issue_status,
      payment_status,
      currency,
      total_amount::text AS total_amount,
      created_at
    FROM public.entry_fees_statement
    WHERE entry_fees_payment_list_id = $1::uuid
    ORDER BY created_at ASC
    `,
    [paymentListId],
  );

  return rows;
}
