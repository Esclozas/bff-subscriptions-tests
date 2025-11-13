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
  closingId: string | null;
  closingName: string | null;

  entryFeesPercent: number | null;
  entryFeesAmount: number | null;
  entryFeesAmountTotal: number | null;
  entryFeesAssignedAmountTotal: number | null;
  entryFeesAssignedOverridden: boolean | null;

  entryFeesAssignedComment: string | null;
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
    closing_id: string | null;
    closing_name: string | null;
    entry_fees_percent: string | number | null;
    entry_fees_amount: string | number | null;
    entry_fees_amount_total: string | number | null;
    entry_fees_assigned_amount_total: string | number | null;
    entry_fees_assigned_overridden: boolean | null;
    entry_fees_assigned_comment: string | null;
    updated_by: string | null;
  };

  const rows = (await sql`
    SELECT
      operation_id,
      closing_id,
      closing_name,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_amount_total,
      entry_fees_assigned_amount_total,
      entry_fees_assigned_overridden,
      entry_fees_assigned_comment,
      updated_by
    FROM ${sql.unsafe(TABLE)}
    WHERE operation_id = ANY(${arrayLiteral}::text[])
  `) as unknown as Row[];

  const map = new Map<string, Extra>();
  for (const r of rows) {
    map.set(r.operation_id, {
      closingId: r.closing_id,
      closingName: r.closing_name,
      entryFeesPercent: r.entry_fees_percent == null ? null : Number(r.entry_fees_percent),
      entryFeesAmount: r.entry_fees_amount == null ? null : Number(r.entry_fees_amount),
      entryFeesAmountTotal:
        r.entry_fees_amount_total == null ? null : Number(r.entry_fees_amount_total),
      entryFeesAssignedAmountTotal:
        r.entry_fees_assigned_amount_total == null
          ? null
          : Number(r.entry_fees_assigned_amount_total),
      entryFeesAssignedOverridden: r.entry_fees_assigned_overridden,
      entryFeesAssignedComment: r.entry_fees_assigned_comment ?? null,
      updatedBy: r.updated_by ?? null,
    });
  }
  return map;
}

/** Upsert par operation_id (TEXT) avec COALESCE pour ne pas écraser les champs non envoyés */
export async function upsertExtraByOperationId(
  operationId: string,
  body: {
    closingId?: string | null;
    closingName?: string | null;

    entryFeesPercent?: number | null;
    entryFeesAmount?: number | null;
    entryFeesAmountTotal?: number | null;
    entryFeesAssignedAmountTotal?: number | null;
    entryFeesAssignedOverridden?: boolean | null;

    entryFeesAssignedManualBy?: string | null;   // → updated_by
    entryFeesAssignedComment?: string | null;    // → entry_fees_assigned_comment
  }
) {
  const sql = getSql();

  type UpsertRow = {
    closing_id: string | null;
    closing_name: string | null;
    entry_fees_percent: string | number | null;
    entry_fees_amount: string | number | null;
    entry_fees_amount_total: string | number | null;
    entry_fees_assigned_amount_total: string | number | null;
    entry_fees_assigned_overridden: boolean | null;
    entry_fees_assigned_comment: string | null;
    updated_by: string | null;
  };

  const rows = (await sql`
    INSERT INTO ${sql.unsafe(TABLE)} (
      operation_id,
      closing_id,
      closing_name,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_amount_total,
      entry_fees_assigned_amount_total,
      entry_fees_assigned_overridden,
      entry_fees_assigned_comment,
      updated_by
    )
    VALUES (
      ${operationId},
      ${body.closingId ?? null}::uuid,
      ${body.closingName ?? null},
      ${body.entryFeesPercent ?? null},
      ${body.entryFeesAmount ?? null},
      ${body.entryFeesAmountTotal ?? null},
      ${body.entryFeesAssignedAmountTotal ?? null},
      ${body.entryFeesAssignedOverridden ?? null},
      ${body.entryFeesAssignedComment ?? null},
      ${body.entryFeesAssignedManualBy ?? null}
    )
    ON CONFLICT (operation_id) DO UPDATE SET
      closing_id = COALESCE(EXCLUDED.closing_id, ${sql.unsafe(TABLE)}.closing_id),
      closing_name = COALESCE(EXCLUDED.closing_name, ${sql.unsafe(TABLE)}.closing_name),
      entry_fees_percent = COALESCE(EXCLUDED.entry_fees_percent, ${sql.unsafe(TABLE)}.entry_fees_percent),
      entry_fees_amount = COALESCE(EXCLUDED.entry_fees_amount, ${sql.unsafe(TABLE)}.entry_fees_amount),
      entry_fees_amount_total = COALESCE(EXCLUDED.entry_fees_amount_total, ${sql.unsafe(TABLE)}.entry_fees_amount_total),
      entry_fees_assigned_amount_total = COALESCE(EXCLUDED.entry_fees_assigned_amount_total, ${sql.unsafe(TABLE)}.entry_fees_assigned_amount_total),
      entry_fees_assigned_overridden = COALESCE(EXCLUDED.entry_fees_assigned_overridden, ${sql.unsafe(TABLE)}.entry_fees_assigned_overridden),
      entry_fees_assigned_comment = COALESCE(EXCLUDED.entry_fees_assigned_comment, ${sql.unsafe(TABLE)}.entry_fees_assigned_comment),
      updated_by = COALESCE(EXCLUDED.updated_by, ${sql.unsafe(TABLE)}.updated_by),
      updated_at = NOW()
    RETURNING
      closing_id,
      closing_name,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_amount_total,
      entry_fees_assigned_amount_total,
      entry_fees_assigned_overridden,
      entry_fees_assigned_comment,
      updated_by
  `) as unknown as UpsertRow[];

  const r = rows[0];
  return r
    ? {
        closingId: r.closing_id,
        closingName: r.closing_name,
        entryFeesPercent: r.entry_fees_percent == null ? null : Number(r.entry_fees_percent),
        entryFeesAmount: r.entry_fees_amount == null ? null : Number(r.entry_fees_amount),
        entryFeesAmountTotal:
          r.entry_fees_amount_total == null ? null : Number(r.entry_fees_amount_total),
        entryFeesAssignedAmountTotal:
          r.entry_fees_assigned_amount_total == null
            ? null
            : Number(r.entry_fees_assigned_amount_total),
        entryFeesAssignedOverridden: r.entry_fees_assigned_overridden,
        entryFeesAssignedComment: r.entry_fees_assigned_comment ?? null,
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
