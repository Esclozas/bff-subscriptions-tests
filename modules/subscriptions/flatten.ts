// lib/flatten.ts
// Helpers de flatten pour l’UI : transforme une souscription upstream + l’extra Neon
// en JSON aplati (shape final consommé par la liste et le détail).
// - toUtcZ() : normalise les dates en string UTC.
// - flattenSubscription() : construit l’objet final (subscriptionId, montant, client, produit,
//   team, owner, closing*, entry_fees_*, etc.).

import type { Extra } from './db';
import type { StatementInfo } from './statements';

export type Flattened = {
  // Ids & statut
  subscriptionId: string | null;
  status: string | null;
  createdDate: string | null;
  updatedDate: string | null;

  signatureDate: string | null;
  validationDate: string | null;

  // 💡 utile pour debug / server: jointure Neon par operationId
  operationId: string | null;

  // Montant
  amountValue: number | null;
  amountCurrency: string | null;

  // Part
  partId: string | null;
  partName: string | null;

  // Fonds (alias du produit pour le groupement)
  fundId: string | null;
  fundName: string | null;

  // Investisseur
  investorId: string | null;
  investorType: string | null;
  investorName: string | null;
  investorFirstName: string | null;

  // Produit
  productId: string | null;
  productName: string | null;

  // Team
  teamId: string | null;
  teamName: string | null;
  teamInternal: boolean | null;

  // Owner
  ownerId: string | null;
  ownerFullName: string | null;
  ownerEmail: string | null;
  ownerInternal: boolean | null;

  // Champs enrichis via Neon (format final pour l’UI)
  entry_fees_percent: number | null;
  entry_fees_amount: number | null;
  entry_fees_amount_total: number | null;

  // Statement enrichi (toujours présent côté UI mais null si absent)
  statement_id: string | null;
  statement_number: string | null;
  statement_status: 'TO_SEND' | 'SENT' | 'PAYED' | 'CANCELLED' | null;
  statement_currency: string | null;
  statement_payment_list_id: string | null;
};

/** Ajoute un Z si la date n’a pas déjà un offset ou un Z */
export function toUtcZ(s: string | null | undefined) {
  if (!s) return null;
  if (/[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s)) return s;
  return `${s}Z`;
}

/** Construit l’objet final aplati à partir de l’item upstream + l’extra Neon (si présent) */
export function flattenSubscription(
  item: any,
  extra?: Extra | null,
  statement?: StatementInfo | null,
): Flattened {
  const investor = item?.client?.person ?? {};
  const owner = item?.owner ?? {};
  const team = item?.team ?? {};
  const product = item?.product ?? {};
  const part = item?.part ?? {};

  const ownerFullName = [owner?.firstName, owner?.name].filter(Boolean).join(' ') || null;

  // operationId côté upstream (string, pas forcément UUID)
  const operationId =
    item?.operationId ??
    item?.operation?.id ??
    null;

  // Valeurs venant de Neon (via Extra camelCase)

  const entry_fees_percent = extra?.entryFeesPercent ?? null;
  const entry_fees_amount = extra?.entryFeesAmount ?? null;
  const entry_fees_amount_total = extra?.entryFeesAmountTotal ?? null;

  // Alias pour groupement
  const fundId = product?.id ?? null;
  const fundName = product?.name ?? null;

  return {
    subscriptionId: item?.id ?? null,
    status: item?.status ?? null,
    createdDate: toUtcZ(item?.createdDate),
    updatedDate: toUtcZ(item?.updatedDate),

    signatureDate: toUtcZ(item?.signatureDate),
    validationDate: toUtcZ(item?.validationDate),

    operationId,

    amountValue: item?.amountCurrency?.value ?? null,
    amountCurrency: item?.amountCurrency?.currency ?? null,

    partId: part?.id ?? null,
    partName: part?.name ?? null,

    fundId,
    fundName,

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
    ownerFullName,
    ownerEmail: owner?.email ?? null,
    ownerInternal: owner?.internal ?? null,

    entry_fees_percent,
    entry_fees_amount,
    entry_fees_amount_total,

    statement_id: statement?.statement_id ?? null,
    statement_number: statement?.statement_number ?? null,
    statement_status: statement?.statement_status ?? null,
    statement_currency: statement?.statement_currency ?? null,
    statement_payment_list_id: statement?.statement_payment_list_id ?? null,
  };
}
