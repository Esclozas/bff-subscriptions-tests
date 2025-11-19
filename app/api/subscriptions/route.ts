/**
 * Route: GET /api/subscriptions
 * ------------------------------
 * Endpoint principal pour l’affichage "liste plate" des souscriptions.
 * Ne gère **pas** les groupements AG Grid → /api/subscriptions/grid est dédié à cela.
 *
 * 🎯 Objectif
 * Fournir au front une liste paginée de souscriptions aplanies (flatten),
 * avec :
 *   - filtres serveur (texte, numérique, booléens),
 *   - tri serveur,
 *   - pagination locale (limit / offset),
 *   - enrichissement Neon (entry_fees_*, closing*, overridden…).
 *
 * Two operating modes:
 * --------------------
 *
 * 1) 🚀 Mode rapide (pas de filtres globaux)
 *    - Appelle upstream /overview avec page + size + sort (= très rapide).
 *    - Merge uniquement les extras Neon des lignes visibles.
 *    - Upstream gère le tri + pagination.
 *    - Retour immédiat.
 *
 * 2) 🔴 Mode global (filtres complexes)
 *    - Déclenché si un filtre porte sur un champ aplatit / Neon.
 *    - Charge *toutes* les souscriptions (via loadAllFlattenedSubscriptions()).
 *        → pagination interne developv4 /overview
 *        → merge Neon
 *        → flatten complet
 *    - Applique tous les filtres globalement :
 *         • texte (contains, case-insensitive)
 *         • numériques (égalité, min, max)
 *         • booléens (égalité stricte)
 *    - Applique ensuite tri + slice (limit/offset).
 *
 * Réponse :
 *   {
 *     items: [...],    // tableau filtré + trié + paginé
 *     total: number,   // total des items APRÈS filtres
 *     limit: number,
 *     offset: number
 *   }
 *
 * 🧪 Mode debug :
 *   /api/subscriptions?raw=1
 *   → renvoie la première page upstream (overview brut), sans flatten ni Neon.
 *
 * 💡 Notes
 * - Le chargement global (mode 2) est désormais factorisé dans
 *     lib/subscriptions.ts → loadAllFlattenedSubscriptions()
 * - Cette route reste strictement dédiée à la vue “liste plate”.
 *   La vue groupée est gérée par /api/subscriptions/grid.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtrasByOperationId } from '@/lib/db';
import { flattenSubscription } from '@/lib/flatten';
import { withCors, handleOptions } from '@/lib/cors';
import { loadAllFlattenedSubscriptions } from '@/lib/subscriptions';

type SourceList = {
  content?: any[];
  items?: any[];
  total?: number;
  totalElements?: number;
  totalPages?: number;
};

// Champs filtrables côté BFF
const TEXT_FILTER_FIELDS = [
  'operationId',
  'amountCurrency',
  'partName',
  'investorType',
  'investorName',
  'investorFirstName',
  'productName',
  'teamName',
  'ownerName',
  'ownerFirstName',
  'closingName',
  'entry_fees_assigned_manual_by',
  'entry_fees_assigned_comment',
] as const;

const NUMERIC_FILTER_FIELDS = [
  'amountValue',
  'entry_fees_percent',
  'entry_fees_amount',
  'entry_fees_amount_total',
  'entry_fees_assigned_amount_total',
] as const;

const BOOLEAN_FILTER_FIELDS = [
  'teamInternal',
  'ownerInternal',
  'entry_fees_assigned_overridden',
] as const;

type TextField = (typeof TEXT_FILTER_FIELDS)[number];
type NumericField = (typeof NUMERIC_FILTER_FIELDS)[number];
type BooleanField = (typeof BOOLEAN_FILTER_FIELDS)[number];

/** Vérifie si l'URL contient un filtre global (texte/numérique/bool, min/max inclus) */
function hasGlobalFilters(url: URL) {
  // Texte
  for (const f of TEXT_FILTER_FIELDS) {
    if (url.searchParams.has(f)) return true;
  }
  // Numérique (égalité + min/max)
  for (const f of NUMERIC_FILTER_FIELDS) {
    if (
      url.searchParams.has(f) ||
      url.searchParams.has(`${f}_min`) ||
      url.searchParams.has(`${f}_max`)
    ) {
      return true;
    }
  }
  // Booléens
  for (const f of BOOLEAN_FILTER_FIELDS) {
    if (url.searchParams.has(f)) return true;
  }
  return false;
}

/** Lit le cookie upstream (ou token fallback) */
function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

function parseNumber(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseBooleanParam(value: string | null): boolean | null {
  if (value == null) return null;
  const v = value.toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const cookie = cookieHeaderFrom(req);

  const order = url.searchParams.get('order')?.toLowerCase() === 'asc' ? 'asc' : 'desc';
  const sortField = url.searchParams.get('sort') ?? '';
  const sortParam = sortField ? `${sortField},${order}` : '';

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '5000'), 5000);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);

  // Debug : renvoyer tel quel la première page upstream
  if (url.searchParams.get('raw') === '1') {
    const p = new URLSearchParams({
      page: '0',
      size: String(limit),
    });
    if (sortParam) p.set('sort', sortParam);

    const data = await upstream(`/overview?${p.toString()}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-jwt': process.env.UPSTREAM_ACCESS_TOKEN || '',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({
        status: [],
        partIds: [],
        personTypes: [],
        internal: false,
        timeZone: 'Europe/Paris',
      }),
    });

    return withCors(NextResponse.json(data));
  }

  const isGlobal = hasGlobalFilters(url);

  /**
   * 🔵 MODE RAPIDE
   * - Aucun filtre global
   * - On laisse upstream gérer pagination + tri
   * - On applique juste le merge Neon pour la page visible
   */
  if (!isGlobal) {
    const size = limit;
    const page = Math.floor(offset / size);

    const upstreamParams = new URLSearchParams({
      page: String(page),
      size: String(size),
    });
    if (sortParam) upstreamParams.set('sort', sortParam);

    const status = url.searchParams.get('status');
    const payload = {
      status: status ? [String(status)] : [],
      partIds: [],
      personTypes: [],
      internal: false,
      timeZone: 'Europe/Paris',
    };

    const data: SourceList = await upstream(`/overview?${upstreamParams.toString()}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-jwt': process.env.UPSTREAM_ACCESS_TOKEN || '',

        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(payload),
    });

    const items = (data.content ?? data.items ?? []) as any[];

    const opIds = items
      .map((i) => i?.operationId ?? i?.operation?.id ?? null)
      .filter(Boolean) as string[];

    let extras = new Map<string, any>();
    if (opIds.length) {
      extras = await selectExtrasByOperationId(opIds);
    }

    const flattened = items.map((it) => {
      const opId = it?.operationId ?? it?.operation?.id ?? '';
      return flattenSubscription(it, extras.get(opId) ?? null);
    });

    const total = Number(
      data.total ?? data.totalElements ?? flattened.length
    );

    return withCors(
      NextResponse.json({
        items: flattened,
        total,
        limit: size,
        offset: page * size,
      }),
    );
  }

  /**
   * 🔴 MODE GLOBAL
   * - Filtre sur champs aplatis / Neon
   * - On charge toutes les pages upstream via loadAllFlattenedSubscriptions
   * - Filtre / tri / pagination local
   */
  let flattened = await loadAllFlattenedSubscriptions(cookie);

  // 1) Filtre status (si présent) en plus des filtres "global"
  const statusFilter = url.searchParams.get('status');
  if (statusFilter) {
    flattened = flattened.filter((x: any) => x.status === statusFilter);
  }

  // 2) Filtres texte (contains, case-insensitive)
  for (const field of TEXT_FILTER_FIELDS) {
    if (!url.searchParams.has(field)) continue;
    const needle = url.searchParams.get(field)!.toLowerCase();
    flattened = flattened.filter((x: any) => {
      const value = x[field];
      if (value == null) return false;
      return String(value).toLowerCase().includes(needle);
    });
  }

  // 3) Filtres numériques (égalité, min, max)
  for (const field of NUMERIC_FILTER_FIELDS) {
    const eqVal = parseNumber(url.searchParams.get(field));
    const minVal = parseNumber(url.searchParams.get(`${field}_min`));
    const maxVal = parseNumber(url.searchParams.get(`${field}_max`));

    if (eqVal != null) {
      flattened = flattened.filter((x: any) => {
        const v = x[field];
        if (v == null) return false;
        return Number(v) === eqVal;
      });
      continue; // si égalité, on ignore min/max pour ce champ
    }

    if (minVal != null) {
      flattened = flattened.filter((x: any) => {
        const v = x[field];
        if (v == null) return false;
        return Number(v) >= minVal;
      });
    }

    if (maxVal != null) {
      flattened = flattened.filter((x: any) => {
        const v = x[field];
        if (v == null) return false;
        return Number(v) <= maxVal;
      });
    }
  }

  // 4) Filtres booléens
  for (const field of BOOLEAN_FILTER_FIELDS) {
    const parsed = parseBooleanParam(url.searchParams.get(field));
    if (parsed === null) continue;
    flattened = flattened.filter((x: any) => x[field] === parsed);
  }

  // 5) Tri local
  if (sortField) {
    flattened.sort((a: any, b: any) => {
      const va = (a as any)[sortField];
      const vb = (b as any)[sortField];

      if (va == null && vb == null) return 0;
      if (va == null) return order === 'asc' ? -1 : 1;
      if (vb == null) return order === 'asc' ? 1 : -1;

      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return order === 'asc' ? cmp : -cmp;
    });
  }

  const total = flattened.length;
  const slice = flattened.slice(offset, offset + limit);

  return withCors(
    NextResponse.json({
      items: slice,
      total,
      limit,
      offset,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
