/**
 * Route: POST /api/subscriptions/grid
 * -----------------------------------
 * Endpoint dédié au mode "Server-Side Row Model" d’AG Grid.
 *
 * 🎯 Objectif
 * Fournir au front :
 *  - soit des "groupes" (niveau hiérarchique en cours),
 *  - soit des lignes feuilles (souscriptions complètes),
 * suivant :
 *  - rowGroupCols : ordre des colonnes de groupement choisi dynamiquement par l’UI,
 *  - groupKeys    : chemin du groupe courant dans la hiérarchie,
 *  - startRow/endRow : pagination serveur,
 *  - sortModel    : tri multi-colonnes,
 *  - filterModel  : filtres (bientôt implémentés côté BFF).
 *
 * 🔌 Fonctionnement
 * 1. Charge toutes les souscriptions aplaties via loadAllFlattenedSubscriptions().
 *    → upstream (overview) + Neon → Flattened[]
 * 2. Filtre les lignes correspondant au chemin (groupKeys).
 * 3. Si le niveau demandé n’est PAS le dernier :
 *      → renvoie une liste de groupes { group: true, id + name + childCount }.
 * 4. Si c’est le niveau feuille :
 *      → renvoie les souscriptions complètes { group: false, ... }.
 * 5. Trie (sortModel) + pagination (startRow/endRow).
 *
 * 🧩 Exemples de hiérarchies possibles
 *  Mode A : fundId → partId → closingId → teamId → distributorId → investorId
 *  Mode B : teamId → distributorId → fundId → partId → closingId → investorId
 *
 * L’ordre dépend ENTIEREMENT de rowGroupCols : le serveur s’aligne.
 *
 * 📁 Utilisation AG Grid
 * Le front appelle cette route à chaque changement :
 *  - d’expansion de groupe,
 *  - de tri,
 *  - de scroll (fetch de page),
 *  - de changement de structure de groupement.
 *
 * 📌 Important
 * - Aucun tri / filtre n’est délégué à l’upstream : tout se fait localement.
 * - Cette route est volontairement séparée de /api/subscriptions (liste plate).
 * - Conçue pour ~5k–10k lignes en mémoire, ce qui reste performant.
 */


export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { loadAllFlattenedSubscriptions } from '@/lib/subscriptions';
import type { Flattened } from '@/lib/flatten';

type RowGroupCol = { field: keyof Flattened };
type SortModelItem = { colId: keyof Flattened; sort: 'asc' | 'desc' };
type GridRequestBody = {
  startRow: number;
  endRow: number;
  rowGroupCols: RowGroupCol[];
  groupKeys: string[];
  sortModel?: SortModelItem[];
  filterModel?: Record<string, any>;
};

// Pour l’instant on n’implémente pas encore filterModel (v2)
function applyFilterModel(rows: Flattened[], _filterModel?: Record<string, any>): Flattened[] {
  return rows;
}

// Tri multi-colonnes pour les lignes feuilles
function applySort(rows: Flattened[], sortModel?: SortModelItem[]): Flattened[] {
  if (!sortModel || sortModel.length === 0) return rows;

  const sorted = [...rows];
  sorted.sort((a, b) => {
    for (const sm of sortModel) {
      const col = sm.colId;
      const dir = sm.sort === 'asc' ? 1 : -1;

      const va = (a as any)[col];
      const vb = (b as any)[col];

      if (va == null && vb == null) continue;
      if (va == null) return -1 * dir;
      if (vb == null) return 1 * dir;

      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
    }
    return 0;
  });

  return sorted;
}

// Tri des groupes (par défaut sur la clé de groupement)
function applyGroupSort(
  groups: any[],
  sortModel: SortModelItem[] | undefined,
  groupField: keyof Flattened,
): any[] {
  if (!groups.length) return groups;

  const sorted = [...groups];

  const relevantSort = sortModel?.find((s) => s.colId === groupField);
  const dir = relevantSort?.sort === 'desc' ? -1 : 1;

  sorted.sort((a, b) => {
    const va = a[groupField];
    const vb = b[groupField];

    if (va == null && vb == null) return 0;
    if (va == null) return -1 * dir;
    if (vb == null) return 1 * dir;

    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  return sorted;
}

/**
 * Pour un field d’ID (fundId, partId, etc.), quel est le champ "Name"
 * à exposer dans les lignes de groupe.
 */
const NAME_FIELD_BY_ID: Partial<Record<keyof Flattened, keyof Flattened>> = {
  fundId: 'fundName',
  partId: 'partName',
  closingId: 'closingName',
  teamId: 'teamName',
  ownerId: 'ownerName',
  investorId: 'investorName',
};

/** Lit le cookie upstream (ou token fallback) */
function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as GridRequestBody;

    const startRow = body.startRow ?? 0;
    const endRow = body.endRow ?? 100;
    const rowGroupCols = body.rowGroupCols ?? [];
    const groupKeys = body.groupKeys ?? [];
    const sortModel = body.sortModel ?? [];
    const filterModel = body.filterModel ?? {};

    const cookie = cookieHeaderFrom(req);

    // 1) Charger toutes les souscriptions aplaties (overview + Neon)
    const all = await loadAllFlattenedSubscriptions(cookie);

    // 2) Appliquer les filtres (v1: stub, on enrichira plus tard avec filterModel)
    let rows: Flattened[] = applyFilterModel(all, filterModel);

    const level = groupKeys.length;
    const hasGrouping = rowGroupCols.length > 0;
    const isLeafLevel = !hasGrouping || level >= rowGroupCols.length;

    // 3) Restreindre aux lignes concernées par le chemin de groupes (groupKeys)
    let rowsAtLevel = rows;
    if (hasGrouping && level > 0) {
      for (let i = 0; i < level && i < rowGroupCols.length; i++) {
        const col = rowGroupCols[i];
        const key = groupKeys[i];
        rowsAtLevel = rowsAtLevel.filter((r) => String((r as any)[col.field] ?? '') === key);
      }
    }

    // 4) Si on est au niveau feuille → renvoyer des lignes complètes
    if (isLeafLevel) {
      const sorted = applySort(rowsAtLevel, sortModel);
      const page = sorted.slice(startRow, endRow);

      const resultRows = page.map((row) => ({
        group: false,
        ...row,
      }));

      return withCors(
        NextResponse.json({
          rows: resultRows,
          lastRow: sorted.length,
        }),
      );
    }

    // 5) Sinon → renvoyer des groupes pour le niveau courant
    const groupCol = rowGroupCols[level];
    const groupField = groupCol.field;

    const buckets = new Map<string, Flattened[]>();
    for (const row of rowsAtLevel) {
      const key = String((row as any)[groupField] ?? '');
      if (!key) continue;
      const bucket = buckets.get(key) ?? [];
      bucket.push(row);
      buckets.set(key, bucket);
    }

    const groups: any[] = [];
    const nameField = NAME_FIELD_BY_ID[groupField];

    for (const [key, bucket] of buckets.entries()) {
      const first = bucket[0];
      const base: any = {
        group: true,
        childCount: bucket.length,
        [groupField]: key,
      };

      if (nameField && first && (first as any)[nameField] != null) {
        base[nameField] = (first as any)[nameField];
      }

      groups.push(base);
    }

    const sortedGroups = applyGroupSort(groups, sortModel, groupField);
    const pageGroups = sortedGroups.slice(startRow, endRow);

    return withCors(
      NextResponse.json({
        rows: pageGroups,
        lastRow: sortedGroups.length,
      }),
    );
  } catch (err: any) {
    console.error('POST /api/subscriptions/grid failed', {
      reason: String(err?.message ?? err),
    });

    return withCors(
      NextResponse.json(
        {
          message: 'Grid failure',
          detail: String(err?.message ?? err),
        },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
