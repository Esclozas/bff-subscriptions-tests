// lib/db.ts
// Fonctions d'accès à Neon (PostgreSQL) pour la table subscription_extra.
// - selectExtrasByOperationId(): récupère les lignes indexées par operation_id (clé TEXT)
//   et les mappe vers un type Extra (camelCase).
// - upsertExtraByOperationId(): crée ou met à jour les extras d’une souscription (closing*, entry_fees_*).
// - deleteExtraByOperationId(): supprime les extras d’une souscription par operation_id.
// Aucune logique métier ici : uniquement SQL + mapping brut des colonnes Neon.

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
  entryFeesPercent: number | null;
  entryFeesAmount: number | null;
  entryFeesAmountTotal: number | null;

  updatedBy: string | null;
};

const TABLE = 'subscription_extra';

/** Lecture en masse des extras par operation_id (TEXT) */
export async function selectExtrasByOperationId(operationIds: string[]) {
  const sql = getSql();
  if (!operationIds.length) return new Map<string, Extra>();

  const ids = operationIds.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!ids.length) return new Map<string, Extra>();

  const arrayLiteral = `{${ids.join(',')}}`;

  type Row = {
    operation_id: string;
    entry_fees_percent: string | number | null;
    entry_fees_amount: string | number | null;
    entry_fees_amount_total: string | number | null;

    updated_by: string | null;
  };

  const rows = (await sql`
    SELECT
      operation_id,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_amount_total,
      updated_by
    FROM ${sql.unsafe(TABLE)}
    WHERE operation_id = ANY(${arrayLiteral}::text[])
  `) as unknown as Row[];

  const map = new Map<string, Extra>();
  for (const r of rows) {
    map.set(r.operation_id, {
      entryFeesPercent: r.entry_fees_percent == null ? null : Number(r.entry_fees_percent),
      entryFeesAmount: r.entry_fees_amount == null ? null : Number(r.entry_fees_amount),
      entryFeesAmountTotal:
        r.entry_fees_amount_total == null ? null : Number(r.entry_fees_amount_total),
      updatedBy: r.updated_by ?? null,
    });
  }
  return map;
}

/** Upsert par operation_id (TEXT) avec COALESCE pour ne pas écraser les champs non envoyés */
export async function upsertExtraByOperationId(
  operationId: string,
  body: {
    entryFeesPercent?: number | null;
    entryFeesAmount?: number | null;
    entryFeesAmountTotal?: number | null;
  }
) {
  const sql = getSql();

  type UpsertRow = {
    entry_fees_percent: string | number | null;
    entry_fees_amount: string | number | null;
    entry_fees_amount_total: string | number | null;
    updated_by: string | null;
  };

  const rows = (await sql`
    INSERT INTO ${sql.unsafe(TABLE)} (
      operation_id,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_amount_total,
      updated_by
    )
    VALUES (
      ${operationId},
      ${body.entryFeesPercent ?? null},
      ${body.entryFeesAmount ?? null},
      ${body.entryFeesAmountTotal ?? null},

    )
    ON CONFLICT (operation_id) DO UPDATE SET
      entry_fees_percent = COALESCE(EXCLUDED.entry_fees_percent, ${sql.unsafe(TABLE)}.entry_fees_percent),
      entry_fees_amount = COALESCE(EXCLUDED.entry_fees_amount, ${sql.unsafe(TABLE)}.entry_fees_amount),
      entry_fees_amount_total = COALESCE(EXCLUDED.entry_fees_amount_total, ${sql.unsafe(TABLE)}.entry_fees_amount_total),
      updated_by = COALESCE(EXCLUDED.updated_by, ${sql.unsafe(TABLE)}.updated_by),
      updated_at = NOW()
    RETURNING
      closing_id,
      closing_name,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_amount_total,
      updated_by
  `) as unknown as UpsertRow[];

  const r = rows[0];
  return r
    ? {
        entryFeesPercent: r.entry_fees_percent == null ? null : Number(r.entry_fees_percent),
        entryFeesAmount: r.entry_fees_amount == null ? null : Number(r.entry_fees_amount),
        entryFeesAmountTotal:
          r.entry_fees_amount_total == null ? null : Number(r.entry_fees_amount_total),
        updatedBy: r.updated_by ?? null,
      }
    : null;
}

/** Suppression simple par operation_id */
export async function deleteExtraByOperationId(operationId: string) {
  const sql = getSql();
  await sql`
    DELETE FROM ${sql.unsafe(TABLE)}
    WHERE operation_id = ${operationId}
  `;
}
