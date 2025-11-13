// lib/flatten.ts
// Transforme le JSON complexe de developv4 (nested) + extras Neon en un objet simple,
// plat et prêt à afficher dans le tableau.
// - flattenSubscription(): fusionne developv4 (overview) + Neon (entry_fees_*) 
// - Garantit un shape identique entre la liste et la route détail.
// Pas de fetch, pas de SQL : uniquement transformation de données.

// Normalise les dates en "...Z" si pas déjà Z ou avec offset
export function toUtcZ(s: string | null | undefined) {
  if (!s) return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return s;
  return `${s}Z`;
}

export type Flattened = {
  subscriptionId: string | null;
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

  entry_fees_percent: number | null;
  entry_fees_amount: number | null;
  entry_fees_amount_total: number | null;
  entry_fees_assigned_amount_total: number | null;
  entry_fees_assigned_overridden: boolean | null;
  entry_fees_assigned_manual_by: string | null;
  entry_fees_assigned_comment: string | null;
};

// "Shape" attendu pour les extras Neon
type ExtraLike = {
  closingId?: string | null;
  closing_id?: string | null;
  closingName?: string | null;
  closing_name?: string | null;

  entryFeesPercent?: number | null;
  entry_fees_percent?: number | null;

  entryFeesAmount?: number | null;
  entry_fees_amount?: number | null;

  entryFeesAmountTotal?: number | null;
  entry_fees_amount_total?: number | null;

  entryFeesAssignedAmountTotal?: number | null;
  entry_fees_assigned_amount_total?: number | null;

  entryFeesAssignedOverridden?: boolean | null;
  entry_fees_assigned_overridden?: boolean | null;

  updatedBy?: string | null;
  updated_by?: string | null;

  entry_fees_assigned_comment?: string | null;
  comment?: string | null;
};

/**
 * Aplatit une subscription developv4 + ses extras Neon
 * dans le format final exposé par le BFF.
 */
export function flattenSubscription(item: any, extra: ExtraLike | null | undefined): Flattened {
  const investor = item?.client?.person ?? {};
  const owner = item?.owner ?? {};
  const team = item?.team ?? {};
  const product = item?.product ?? {};
  const part = item?.part ?? {};

  const closingId = extra?.closingId ?? extra?.closing_id ?? null;
  const closingName = extra?.closingName ?? extra?.closing_name ?? null;

  const entry_fees_percent =
    extra?.entryFeesPercent ??
    extra?.entry_fees_percent ??
    null;

  const entry_fees_amount =
    extra?.entryFeesAmount ??
    extra?.entry_fees_amount ??
    null;

  const entry_fees_amount_total =
    extra?.entryFeesAmountTotal ??
    extra?.entry_fees_amount_total ??
    null;

  const entry_fees_assigned_amount_total =
    extra?.entryFeesAssignedAmountTotal ??
    extra?.entry_fees_assigned_amount_total ??
    null;

  const entry_fees_assigned_overridden =
    extra?.entryFeesAssignedOverridden ??
    extra?.entry_fees_assigned_overridden ??
    null;

  const entry_fees_assigned_manual_by =
    extra?.updatedBy ??
    extra?.updated_by ??
    null;

  const entry_fees_assigned_comment =
    extra?.entry_fees_assigned_comment ??
    extra?.comment ??
    null;

  return {
    subscriptionId: item?.id ?? null,
    status: item?.status ?? null,
    createdDate: toUtcZ(item?.createdDate),
    updatedDate: toUtcZ(item?.updatedDate),

    amountValue: item?.amountCurrency?.value ?? null,
    amountCurrency: item?.amountCurrency?.currency ?? null,

    partId: part?.id ?? null,
    partName: part?.name ?? null,

    investorId: investor?.id ?? null,
    investorType: investor?.personType ?? null,
    investorName: investor?.name ?? null,
    investorFirstName: investor?.firstName ?? null,

    productId: product?.id ?? null,
    productName: product?.name ?? null,

    teamId: team?.id ?? null,
    teamName: team?.name ?? null,
    teamInternal: team?.internal ?? null,

    ownerId: owner?.id ?? null,
    ownerName: owner?.name ?? null,
    ownerFirstName: owner?.firstName ?? null,
    ownerEmail: owner?.email ?? null,
    ownerInternal: owner?.internal ?? null,

    closingId,
    closingName,
    entry_fees_percent,
    entry_fees_amount,
    entry_fees_amount_total,
    entry_fees_assigned_amount_total,
    entry_fees_assigned_overridden,
    entry_fees_assigned_manual_by,
    entry_fees_assigned_comment,
  };
}

/**
 * Legacy / compat : alias vers flattenSubscription
 * (si tu utilisais déjà `flatten` ailleurs).
 */
export function flatten(item: any, extra?: ExtraLike | null): Flattened {
  return flattenSubscription(item, extra);
}
