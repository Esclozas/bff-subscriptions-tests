// lib/db.ts
// Fonctions d'accès à Neon (PostgreSQL).
// - selectExtrasByOperationId(): récupère les lignes de la table subscription_extra
//   indexées par operation_id (clé TEXT).
// - upsertExtraByOperationId(): crée ou met à jour les extras pour 1 subscription.
// - deleteExtraByOperationId(): supprime les extras d’une subscription.
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

  entryFeesPercent: number | null;             // entry_fees_percent
  entryFeesAmount: number | null;              // entry_fees_amount
  entryFeesAmountTotal: number | null;         // entry_fees_amount_total
  entryFeesAssignedAmountTotal: number | null; // entry_fees_assigned_amount_total
  entryFeesAssignedOverridden: boolean | null; // entry_fees_assigned_overridden

  entryFeesAssignedComment: string | null;     // entry_fees_assigned_comment
  updatedBy: string | null;                    // updated_by
};

const TABLE = 'subscription_extra';

/** Jointure par operation_id (TEXT) */
export async function selectExtrasByOperationId(operationIds: string[]) {
  const sql = getSql();
  if (!operationIds.length) return new Map<string, Extra>();

  const ids = operationIds.map((s) => String(s ?? '').trim()).filter(Boolean);
  if (!ids.length) return new Map<string, Extra>();

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
    WHERE operation_id = ANY(${ids}::text[])
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

/** Upsert par operation_id (TEXT) */
export async function upsertExtraByOperationId(
  operationId: string,
  body: {
    closingId?: string | null;
    closingName?: string | null;
    entryFeesPercent?: number | null;
    entryFeesAmount?: number | null;
    comment?: string | null;
  }
) {
  const sql = getSql();

  type UpsertRow = {
    closing_id: string | null;
    closing_name: string | null;
    entry_fees_percent: number | null;
    entry_fees_amount: number | null;
    entry_fees_assigned_comment: string | null;
  };

  const row = (await sql`
    INSERT INTO ${sql.unsafe(TABLE)} (
      operation_id,
      closing_id,
      closing_name,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_assigned_comment
    )
    VALUES (
      ${operationId},
      ${body.closingId ?? null}::uuid,
      ${body.closingName ?? null},
      ${body.entryFeesPercent ?? null},
      ${body.entryFeesAmount ?? null},
      ${body.comment ?? null}
    )
    ON CONFLICT (operation_id) DO UPDATE SET
      closing_id = EXCLUDED.closing_id,
      closing_name = EXCLUDED.closing_name,
      entry_fees_percent = EXCLUDED.entry_fees_percent,
      entry_fees_amount = EXCLUDED.entry_fees_amount,
      entry_fees_assigned_comment = EXCLUDED.entry_fees_assigned_comment,
      updated_at = NOW()
    RETURNING
      closing_id,
      closing_name,
      entry_fees_percent,
      entry_fees_amount,
      entry_fees_assigned_comment
  `) as unknown as UpsertRow[];

  return row[0]
    ? {
        closingId: row[0].closing_id,
        closingName: row[0].closing_name,
        entryFeesPercent:
          row[0].entry_fees_percent === null ? null : Number(row[0].entry_fees_percent),
        entryFeesAmount:
          row[0].entry_fees_amount === null ? null : Number(row[0].entry_fees_amount),
        entryFeesAssignedComment: row[0].entry_fees_assigned_comment ?? null,
      }
    : null;
}

export async function deleteExtraByOperationId(operationId: string) {
  const sql = getSql();
  await sql`DELETE FROM ${sql.unsafe(TABLE)} WHERE operation_id = ${operationId}`;
}
