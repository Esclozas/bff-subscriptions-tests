import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.NEON_DATABASE_URL!);

// Helpers
export async function selectExtras(ids: string[]) {
  if (!ids.length) return new Map<string, any>();
  const rows = await sql<
    { subscription_id: string; closing_id: string|null; closing_name: string|null;
      retro_percent: number|null; retro_amount: number|null; comment: string|null }[]
  >`
    SELECT subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment
    FROM subscription_extras
    WHERE subscription_id = ANY(${ids}::uuid[])
  `;
  const map = new Map<string, any>();
  rows.forEach(r => map.set(r.subscription_id, {
    closingId: r.closing_id,
    closingName: r.closing_name,
    retroPercent: r.retro_percent === null ? null : Number(r.retro_percent),
    retroAmount: r.retro_amount === null ? null : Number(r.retro_amount),
    comment: r.comment ?? null
  }));
  return map;
}

export async function upsertExtra(id: string, body: {
  closingId?: string|null;
  closingName?: string|null;
  retroPercent?: number|null;
  retroAmount?: number|null;
  comment?: string|null;
}) {
  const row = await sql<
    { closing_id: string|null; closing_name: string|null; retro_percent: number|null; retro_amount: number|null; comment: string|null }[]
  >`
    INSERT INTO subscription_extras (subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment)
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
  `;
  return row[0] ? {
    closingId: row[0].closing_id,
    closingName: row[0].closing_name,
    retroPercent: row[0].retro_percent === null ? null : Number(row[0].retro_percent),
    retroAmount: row[0].retro_amount === null ? null : Number(row[0].retro_amount),
    comment: row[0].comment ?? null
  } : null;
}

export async function deleteExtra(id: string) {
  await sql`DELETE FROM subscription_extras WHERE subscription_id = ${id}::uuid`;
}
