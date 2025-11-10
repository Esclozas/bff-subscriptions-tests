export type FlatSubscription = {
  subscriptionId: string;
  status: string | null;
  createdDate: string | null;
  updatedDate: string | null;
  amountValue: number | null;
  amountCurrency: string | null;
  partId: string | null;
  partName: string | null;
  investorId: string | null;
  investorType: string | null;
  investorName: string | null;
  investorFirstName: string | null;
  productId: string | null;
  productName: string | null;
  teamId: string | null;
  teamName: string | null;
  teamInternal: boolean | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerFirstName: string | null;
  ownerEmail: string | null;
  ownerInternal: boolean | null;
  closingId: string | null;
  closingName: string | null;
  retroPercent: number | null;
  retroAmount: number | null;
  comment?: string | null;
};

export type ExtraRow = {
  subscription_id: string;
  closing_id: string | null;
  closing_name: string | null;
  retro_percent: string | null;
  retro_amount: string | null;
  comment: string | null;
};

export function normalizeNumber(n: unknown): number | null {
  if (n == null) return null;
  const v = typeof n === 'string' ? Number(n) : (n as number);
  return Number.isFinite(v) ? v : null;
}

export function flattenItem(src: any, extra?: ExtraRow): FlatSubscription {
  return {
    subscriptionId: src.id,
    status: src.status ?? null,
    createdDate: src.createdDate ?? null,
    updatedDate: src.updatedDate ?? null,
    amountValue: src.amountValue ?? null,
    amountCurrency: src.amountCurrency ?? null,
    partId: src.part?.id ?? null,
    partName: src.part?.name ?? null,
    investorId: src.investor?.id ?? null,
    investorType: src.investor?.type ?? null,
    investorName: src.investor?.name ?? null,
    investorFirstName: src.investor?.firstName ?? null,
    productId: src.product?.id ?? null,
    productName: src.product?.name ?? null,
    teamId: src.team?.id ?? null,
    teamName: src.team?.name ?? null,
    teamInternal: src.team?.internal ?? null,
    ownerId: src.owner?.id ?? null,
    ownerName: src.owner?.name ?? null,
    ownerFirstName: src.owner?.firstName ?? null,
    ownerEmail: src.owner?.email ?? null,
    ownerInternal: src.owner?.internal ?? null,
    closingId: extra?.closing_id ?? null,
    closingName: extra?.closing_name ?? null,
    retroPercent: normalizeNumber(extra?.retro_percent),
    retroAmount: normalizeNumber(extra?.retro_amount),
    comment: extra?.comment ?? null,
  };
}

export function searchable(it: FlatSubscription): string {
  return [
    it.investorName, it.investorFirstName,
    it.productName, it.teamName, it.ownerName, it.partName
  ].filter(Boolean).join(' ').toLowerCase();
}
