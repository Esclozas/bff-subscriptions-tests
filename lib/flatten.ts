type UpstreamItem = any; // typage minimaliste pour aller vite

export function toUtcZ(s: string | null | undefined) {
  if (!s) return null;
  // Si déjà avec Z, on renvoie tel quel
  if (/[zZ]$/.test(s)) return s;
  // Ajoute 'Z' (en supposant déjà UTC côté source)
  return `${s}Z`;
}

export function flatten(item: UpstreamItem, extra?: any) {
  const out = {
    subscriptionId: item.id ?? null,
    status: item.status ?? null,
    createdDate: toUtcZ(item.createdDate),
    updatedDate: toUtcZ(item.updatedDate),

    amountValue: item.amountCurrency?.value ?? null,
    amountCurrency: item.amountCurrency?.currency ?? null,

    partId: item.part?.id ?? null,
    partName: item.part?.name ?? null,

    investorId: item.client?.person?.id ?? null,
    investorType: item.client?.person?.personType ?? null,
    investorName: item.client?.person?.name ?? null,
    investorFirstName: item.client?.person?.firstName ?? null,

    productId: item.product?.id ?? null,
    productName: item.product?.name ?? null,

    teamId: item.team?.id ?? null,
    teamName: item.team?.name ?? null,
    teamInternal: item.team?.internal ?? null,

    ownerId: item.owner?.id ?? null,
    ownerName: item.owner?.name ?? null,
    ownerFirstName: item.owner?.firstName ?? null,
    ownerEmail: item.owner?.email ?? null,
    ownerInternal: item.owner?.internal ?? null,

    // champs Neon (initialisés null)
    closingId: null as string|null,
    closingName: null as string|null,
    retroPercent: null as number|null,
    retroAmount: null as number|null
  };

  if (extra) {
    out.closingId     = extra.closingId     ?? out.closingId;
    out.closingName   = extra.closingName   ?? out.closingName;
    out.retroPercent  = extra.retroPercent  ?? out.retroPercent;
    out.retroAmount   = extra.retroAmount   ?? out.retroAmount;
  }
  return out;
}
