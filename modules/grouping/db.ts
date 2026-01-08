import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

export type GroupStructure = {
  id: string;
  label: string | null;
  createdAt: string;
  isActive: boolean;
};

export type MappingRow = {
  source_group_id: string;
  billing_group_id: string;
};

function pgErrorCode(err: any): string | null {
  return err?.code ?? err?.cause?.code ?? null;
}

export async function listGroupStructures(opts: {
  limit: number;
  isActive?: boolean | null;
  createdBy?: string | null;
  cursor?: { createdAt: string; id: string } | null;
}) {
  const sql = getSql();
  const limit = Math.max(1, Math.min(opts.limit, 200));

  // ✅ Conditions "de base" (filtres seulement) → servent au COUNT
  const baseConditions: any[] = [];

  if (opts.isActive !== undefined && opts.isActive !== null) {
    baseConditions.push(sql`is_active = ${opts.isActive}`);
  }
  if (opts.createdBy) {
    baseConditions.push(sql`created_by = ${opts.createdBy}`);
  }

  const baseWhereExpr =
    baseConditions.length === 0
      ? sql``
      : baseConditions.slice(1).reduce((acc, c) => sql`${acc} AND ${c}`, baseConditions[0]);

  const baseWhereClause = baseConditions.length ? sql`WHERE ${baseWhereExpr}` : sql``;

  // ✅ COUNT total (sans cursor)
  const totalRows = (await sql`
    SELECT COUNT(*)::int AS total
    FROM group_structures
    ${baseWhereClause}
  `) as any[];

  const total = Number(totalRows?.[0]?.total ?? 0);

  // ✅ Conditions de page = base + cursor → servent aux items paginés
  const pageConditions: any[] = [...baseConditions];

  if (opts.cursor) {
    pageConditions.push(
      sql`(created_at, id) < (${opts.cursor.createdAt}::timestamptz, ${opts.cursor.id}::uuid)`,
    );
  }

  const pageWhereExpr =
    pageConditions.length === 0
      ? sql``
      : pageConditions.slice(1).reduce((acc, c) => sql`${acc} AND ${c}`, pageConditions[0]);

  const pageWhereClause = pageConditions.length ? sql`WHERE ${pageWhereExpr}` : sql``;

  // ✅ Items paginés (avec cursor)
  const rows = (await sql`
    SELECT id, label, created_at, is_active
    FROM group_structures
    ${pageWhereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as any[];

  const items = rows.map((r: any) => ({
    id: r.id,
    label: r.label ?? null,
    createdAt: r.created_at,
    isActive: !!r.is_active,
  }));

  const nextCursor =
    items.length === limit
      ? { createdAt: items[items.length - 1]!.createdAt, id: items[items.length - 1]!.id }
      : null;

  return { items, nextCursor, total };
}


export async function getGroupStructure(id: string): Promise<GroupStructure | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, label, created_at, is_active
    FROM group_structures
    WHERE id = ${id}::uuid
    LIMIT 1
  `) as any[];

  const r = rows[0];
  if (!r) return null;

  return {
    id: r.id,
    label: r.label ?? null,
    createdAt: r.created_at,
    isActive: !!r.is_active,
  };
}

export async function getActiveGroupStructure(): Promise<GroupStructure | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, label, created_at, is_active
    FROM group_structures
    WHERE is_active = true
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `) as any[];

  const r = rows[0];
  if (!r) return null;

  return {
    id: r.id,
    label: r.label ?? null,
    createdAt: r.created_at,
    isActive: !!r.is_active,
  };
}

export async function getGroupStructureMap(groupStructureId: string): Promise<MappingRow[]> {
  const sql = getSql();

  const rows = (await sql`
    SELECT source_group_id, billing_group_id
    FROM group_structure_map
    WHERE group_structure_id::text = ${groupStructureId}
    ORDER BY source_group_id ASC
  `) as any[];

  return rows.map((r: any) => ({
    source_group_id: r.source_group_id,
    billing_group_id: r.billing_group_id,
  }));
}


export async function resolveBillingGroupId(groupStructureId: string, sourceGroupId: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT billing_group_id
    FROM group_structure_map
    WHERE group_structure_id = ${groupStructureId}::uuid
      AND source_group_id = ${sourceGroupId}::uuid
    LIMIT 1
  `) as any[];

  return (rows[0]?.billing_group_id as string | undefined) ?? sourceGroupId;
}

export async function createGroupStructure(input: {
  label?: string | null;
  activate: boolean;
  mappings: MappingRow[];
}) {
  const sql = getSql();

  // 1) Insert version (hors transaction) -> récupère id correctement
  const versionRows = (await sql`
    INSERT INTO group_structures (label, is_active)
    VALUES (${input.label ?? null}, ${false})
    RETURNING id, label, created_at, is_active
  `) as any[];

  const versionRow = versionRows[0];
  if (!versionRow?.id) {
    throw new Error('Failed to create group_structures row (missing id)');
  }

  const groupStructureId: string = versionRow.id;

  // 2) Prépare inserts mapping
  const mappingQueries = input.mappings.map((m) => sql`
    INSERT INTO group_structure_map (group_structure_id, source_group_id, billing_group_id)
    VALUES (${groupStructureId}::uuid, ${m.source_group_id}::uuid, ${m.billing_group_id}::uuid)
  `);

  // 3) Activation optionnelle (même transaction)
  const activateQueries = input.activate
    ? [
        sql`UPDATE group_structures SET is_active = false WHERE is_active = true`,
        sql`UPDATE group_structures SET is_active = true WHERE id = ${groupStructureId}::uuid`,
      ]
    : [];

  try {
    await sql.transaction([...mappingQueries, ...activateQueries]);
  } catch (err: any) {
    const code = pgErrorCode(err);
    throw Object.assign(err, { _pgcode: code });
  }

  return {
    id: groupStructureId,
    label: versionRow.label ?? null,
    createdAt: versionRow.created_at,
    isActive: input.activate ? true : false,
  } satisfies GroupStructure;
}


export async function activateGroupStructure(groupStructureId: string) {
  const sql = getSql();

  const existing = await getGroupStructure(groupStructureId);
  if (!existing) return { ok: false as const, status: 404 as const };

  try {
    await sql.transaction([
      sql`UPDATE group_structures SET is_active = false WHERE is_active = true`,
      sql`UPDATE group_structures SET is_active = true WHERE id = ${groupStructureId}::uuid`,
    ]);
  } catch (err: any) {
    const code = pgErrorCode(err);
    throw Object.assign(err, { _pgcode: code });
  }

  return { ok: true as const };
}
