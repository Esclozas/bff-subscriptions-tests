/**
 * Route: GET /api/subscriptions
 *
 * Global filter / sort :
 * - Récupère TOUTES les subscriptions depuis developv4 (/overview) via pagination interne.
 * - Aplatit chaque item (format unique BFF).
 * - Merge automatiquement les données Neon via operationId.
 * - Applique les filtres et le tri sur le tableau GLOBAL:
 *   - Filtres texte: "contains" (case-insensitive).
 *   - Filtres numériques: égalité.
 *   - Filtres booléens: égalité.
 * - Applique ensuite limit/offset en local sur le tableau filtré.
 *
 * Réponse:
 *   {
 *     items: [...],       // page filtrée + triée
 *     total: number,      // total d'items APRÈS filtres
 *     limit: number,
 *     offset: number
 *   }
 *
 * Usage:
 *   /api/subscriptions?status=TO_BE_SENT&limit=20&offset=0
 *   /api/subscriptions?closingName=clos&sort=entry_fees_amount&order=desc
 *   /api/subscriptions?teamInternal=true&amountCurrency=EUR
 *   /api/subscriptions?raw=1     → renvoie la 1ère page brute developv4 (debug)
 */

/**
 * Route optimisée: GET /api/subscriptions
 *
 * Deux modes :
 *
 * 1) Mode rapide (pas de filtre global) :
 *    - Appel d'une seule page upstream (page/size/sort, + status si fourni)
 *    - Merge Neon uniquement pour les items visibles
 *    - Tri & pagination gérés par upstream
 *
 * 2) Mode global-filter (si filtre sur champs aplatis / Neon) :
 *    - Charge TOUTES les pages upstream (PAGE_SIZE)
 *    - Merge Neon pour tout
 *    - Applique filtres + tri en local
 *    - Applique ensuite limit/offset en local
 *
 * Réponse :
 *   {
 *     items: [...],
 *     total: number,  // après filtres
 *     limit: number,
 *     offset: number
 *   }
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtrasByOperationId } from '@/lib/db';
import { flattenSubscription } from '@/lib/flatten';

type SourceList = {
  content?: any[];
  items?: any[];
  total?: number;
  totalElements?: number;
  totalPages?: number;
};

const PAGE_SIZE = 1000; // global mode: assez grand pour tout prendre en 1 appel

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

/** Appel direct à l'overview upstream (global mode) */
async function upstreamOverview(page: number, size: number, cookie: string) {
  const base = process.env.UPSTREAM_API_BASE_URL!;
  const url = `${base}/overview?page=${page}&size=${size}`;
  const payload = {
    status: [],
    partIds: [],
    personTypes: [],
    internal: false,
    timeZone: 'Europe/Paris',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Upstream ${res.status} ${res.statusText} @ ${url} :: ${text.slice(0, 250)}`
    );
  }
  return res.json() as Promise<SourceList & { number?: number; size?: number }>;
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

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '250'), 250);
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

    return NextResponse.json(data);
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

    return NextResponse.json({
      items: flattened,
      total,
      limit: size,
      offset: page * size,
    });
  }

  /**
   * 🔴 MODE GLOBAL
   * - Filtre sur champs aplatis / Neon
   * - On charge toutes les pages upstream
   * - Merge Neon global
   * - Filtre / tri / pagination local
   */
  let page = 0;
  let full: any[] = [];
  let maxPages = 10;

  while (page < maxPages) {
    const data = await upstreamOverview(page, PAGE_SIZE, cookie);

    const list =
      Array.isArray(data.content) ? data.content :
      Array.isArray(data.items)   ? data.items   : [];

    full = full.concat(list);

    const totalPages =
      typeof data.totalPages === 'number'
        ? data.totalPages
        : typeof data.total === 'number'
        ? Math.ceil(data.total / PAGE_SIZE)
        : null;

    if (totalPages != null) maxPages = totalPages;
    if (list.length < PAGE_SIZE) break;

    page++;
  }

  const opIds = full
    .map((i) => i?.operationId ?? i?.operation?.id ?? null)
    .filter(Boolean) as string[];

  let extras = new Map<string, any>();
  if (opIds.length) {
    extras = await selectExtrasByOperationId(opIds);
  }

  let flattened = full.map((it) => {
    const opId = it?.operationId ?? it?.operation?.id ?? '';
    return flattenSubscription(it, extras.get(opId) ?? null);
  });

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
      const va = a[sortField];
      const vb = b[sortField];

      if (va == null && vb == null) return 0;
      if (va == null) return order === 'asc' ? -1 : 1;
      if (vb == null) return order === 'asc' ? 1 : -1;

      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return order === 'asc' ? cmp : -cmp;
    });
  }

  const total = flattened.length;
  const slice = flattened.slice(offset, offset + limit);

  return NextResponse.json({
    items: slice,
    total,
    limit,
    offset,
  });
}
