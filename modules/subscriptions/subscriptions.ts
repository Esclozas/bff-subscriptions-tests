/**
 * lib/subscriptions.ts
 * ---------------------
 * Ce module centralise le chargement complet des souscriptions depuis developv4
 * (endpoint /overview) + le merge des données Neon + le flatten unique au BFF.
 *
 * 🔍 Rôle
 * - Appeler toutes les pages du /overview upstream (pagination interne).
 * - Avec PAGE_SIZE = 5000, dans 99 % des cas l’appel se fait en 1 seule requête.
 * - Récupérer tous les operationId visibles.
 * - Charger en une fois les extras depuis Neon via selectExtrasByOperationId().
 * - Combiner pour chaque souscription les données upstream + Neon via flattenSubscription().
 * - Retourner un tableau final entièrement aplati : Flattened[].
 *
 * 💡 Utilisation
 * - Ce module n'applique AUCUN tri, filtre ou pagination.
 * - C’est juste un "loader" universel et complet.
 * - Requêtes lourdes → utilisé seulement en “mode global” (filtres avancés) ou pour /grid (groupements).
 *
 * 📌 Points clés
 * - Rend possible les filtres complets (texte/numérique/bool/overrides) dans /api/subscriptions.
 * - Rend possible les vues groupées serveur (AG Grid Server-Side Row Model).
 * - Retourne toujours l’ensemble des souscriptions (5k–10k max), ce qui reste raisonnable.
 */


import { selectExtrasByOperationId } from './db';
import { flattenSubscription, type Flattened } from './flatten';
import { upstream } from '../../lib/http';


type SourceList = {
  content?: any[];
  items?: any[];
  total?: number;
  totalElements?: number;
  totalPages?: number;
};

// PAGE_SIZE doit matcher le max réellement utilisé par /overview (actuellement 2000)
const PAGE_SIZE = 2000;

/** Appel direct à l'overview upstream, identique à ce que tu faisais en mode global */
async function upstreamOverview(page: number, size: number, cookie: string) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  });

  const payload = {
    status: [],
    partIds: [],
    personTypes: [],
    internal: false,
    timeZone: 'Europe/Paris',
  };

  const data = await upstream(`/overview?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-jwt': process.env.UPSTREAM_ACCESS_TOKEN || '',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
  });

  return data as SourceList;
}


/**
 * Charge TOUTES les souscriptions depuis /overview,
 * merge Neon, et renvoie un tableau Flattened[].
 */
export async function loadAllFlattenedSubscriptions(
  cookie: string,
): Promise<Flattened[]> {
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

  const flattened = full.map((it) => {
    const opId = it?.operationId ?? it?.operation?.id ?? '';
    return flattenSubscription(it, extras.get(opId) ?? null);
  });

    if (process.env.NODE_ENV !== 'production') {
    logInconsistentIdNamePairs(flattened);
    }

  return flattened;
}

// ------------------------------------------------------------
// DEBUG : vérifie cohérence ID ↔ Name pour aider AG Grid
// ------------------------------------------------------------

function logInconsistentIdNamePairs(rows: Flattened[]) {
  type PairMap = Map<string, Set<string>>;

  const check = (fieldId: keyof Flattened, fieldName: keyof Flattened, label: string) => {
    const map: PairMap = new Map();

    for (const r of rows) {
      const id = (r as any)[fieldId];
      const name = (r as any)[fieldName];
      if (!id) continue;

      const set = map.get(String(id)) ?? new Set<string>();
      if (name != null) set.add(String(name));
      map.set(String(id), set);
    }

    for (const [id, names] of map.entries()) {
      if (names.size > 1) {
        console.warn(
          `[BFF DEBUG] Inconsistency for ${label}: id=${id} has multiple names:`,
          Array.from(names),
        );
      }
    }
  };

  check('fundId', 'fundName', 'fund');
  check('partId', 'partName', 'part');
  check('teamId', 'teamName', 'team');
  check('ownerId', 'ownerFullName', 'owner');
  check('investorId', 'investorName', 'investor');
}
