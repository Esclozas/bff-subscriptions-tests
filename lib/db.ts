import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

export type Extra = {
  closingId: string | null;
  closingName: string | null;
  retroPercent: number | null;
  retroAmount: number | null;
  comment: string | null;
};

const TABLE = 'subscription_extra'; // 👈 singulier (conforme à Neon)

export async function selectExtras(ids: string[]) {
  const sql = getSql();
  if (!ids.length) return new Map<string, Extra>();

  type ExtraRow = {
    subscription_id: string;
    closing_id: string | null;
    closing_name: string | null;
    retro_percent: number | null;
    retro_amount: number | null;
    comment: string | null;
  };

  const rows = await sql`
    SELECT subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment
    FROM ${sql.unsafe(TABLE)}
    WHERE subscription_id = ANY(${ids}::uuid[])
  ` as unknown as ExtraRow[];

  const map = new Map<string, Extra>();
  rows.forEach(r =>
    map.set(r.subscription_id, {
      closingId: r.closing_id,
      closingName: r.closing_name,
      retroPercent: r.retro_percent === null ? null : Number(r.retro_percent),
      retroAmount: r.retro_amount === null ? null : Number(r.retro_amount),
      comment: r.comment ?? null,
    })
  );
  return map;
}

export async function upsertExtra(
  id: string,
  body: {
    closingId?: string | null;
    closingName?: string | null;
    retroPercent?: number | null;
    retroAmount?: number | null;
    comment?: string | null;
  }
) {
  const sql = getSql();

  type UpsertRow = {
    closing_id: string | null;
    closing_name: string | null;
    retro_percent: number | null;
    retro_amount: number | null;
    comment: string | null;
  };

  const row = await sql`
    INSERT INTO ${sql.unsafe(TABLE)} (subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment)
    VALUES (${id}::uuid, ${body.closingId ?? null}::uuid, ${body.closingName ?? null},
            ${body.retroPercent ?? null}, ${body.retroAmount ?? null}, ${body.comment ?? null})
    ON CONFLICT (subscription_id) DO UPDATE SET
      closing_id = EXCLUDED.closing_id,
      closing_name = EXCLUDED.closing_name,
      retro_percent = EXCLUDED.retro_percent,
      retro_amount = EXCLUDED.retro_amount,
      comment = EXCLUDED.comment,
      updated_at = NOW()
    RETURNING closing_id, closing_name, retro_percent, retro_amount, comment
  ` as unknown as UpsertRow[];

  return row[0]
    ? {
        closingId: row[0].closing_id,
        closingName: row[0].closing_name,
        retroPercent: row[0].retro_percent === null ? null : Number(row[0].retro_percent),
        retroAmount: row[0].retro_amount === null ? null : Number(row[0].retro_amount),
        comment: row[0].comment ?? null,
      }
    : null;
}

export async function deleteExtra(id: string) {
  const sql = getSql();
  await sql`DELETE FROM ${sql.unsafe(TABLE)} WHERE subscription_id = ${id}::uuid`;
}
