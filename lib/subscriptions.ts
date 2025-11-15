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

type SourceList = {
  content?: any[];
  items?: any[];
  total?: number;
  totalElements?: number;
  totalPages?: number;
};

const PAGE_SIZE = 5000;

/** Appel direct à l'overview upstream, identique à ce que tu faisais en mode global */
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

  return res.json() as Promise<SourceList>;
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

  return flattened;
}
