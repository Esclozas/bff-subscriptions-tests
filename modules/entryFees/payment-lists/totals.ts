type FlatSub = {
  subscriptionId: string | null;
  amountCurrency: string | null;
  entry_fees_amount_total: number | null;
  entry_fees_assigned_amount_total: number | null;
};

/**
 * Stratégie simple:
 * - Appelle /api/subscriptions/all (BFF) une fois
 * - Filtre sur subscriptionIds
 * - Somme par currency
 */
export async function computeAnnouncedTotalsFromBff(args: {
  origin: string;
  subscriptionIds: string[];
  cookieHeader?: string;
}) {
  const res = await fetch(`${args.origin}/api/subscriptions/all`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(args.cookieHeader ? { Cookie: args.cookieHeader } : {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) throw new Error(`BFF /api/subscriptions/all returned ${res.status}`);

  const data = await res.json();
  const items = (data?.items ?? []) as FlatSub[];

  const wanted = new Set(args.subscriptionIds);
  const picked = items.filter((x) => x.subscriptionId && wanted.has(x.subscriptionId));

  const byCur = new Map<string, number>();
  for (const s of picked) {
    const cur = s.amountCurrency ?? 'EUR';
    const amount =
      s.entry_fees_assigned_amount_total ??
      s.entry_fees_amount_total ??
      0;

    byCur.set(cur, (byCur.get(cur) ?? 0) + Number(amount ?? 0));
  }

  // numeric -> string (2 décimales) pour insertion en DB
  return Array.from(byCur.entries()).map(([currency, sum]) => ({
    currency,
    total_announced: sum.toFixed(2),
  }));
}
