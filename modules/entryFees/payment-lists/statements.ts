import { createStatementsAndLinesTx } from './statements_db';
import { buildStatementNumber, sortStatementGroups } from './statement_number';

type FlattenedSub = {
  subscriptionId: string | null;
  amountCurrency: string | null;
  teamId: string | null;
  entry_fees_amount: number | null;
};

type GroupStructureActive = { id: string };

type GroupStructureMap = {
  group_structure_id: string;
  mappings: Array<{ source_group_id: string; billing_group_id: string }>;
};

async function fetchActiveGroupStructureId(origin: string) {
  const res = await fetch(`${origin}/api/group-structures/active`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`/api/group-structures/active returned ${res.status}`);
  const data = (await res.json()) as GroupStructureActive;
  if (!data?.id) throw new Error('BAD_REQUEST_GROUP_STRUCTURE_ACTIVE_MISSING_ID');
  return data.id;
}

async function fetchGroupStructureMap(origin: string, groupStructureId: string) {
  const res = await fetch(`${origin}/api/group-structures/${groupStructureId}/map`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`/api/group-structures/${groupStructureId}/map returned ${res.status}`);
  return (await res.json()) as GroupStructureMap;
}

function getEntryFeesAmountAllowZero(sub: FlattenedSub): number {
  const v = Number(sub.entry_fees_amount);
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`BAD_REQUEST_INVALID_ENTRY_FEES_AMOUNT subscriptionId=${sub.subscriptionId}`);
  }
  return v; // 0 autorisé
}

function computeBillingGroupKey(teamId: string, map: Map<string, string>): string {
  // mapping : teamId (source) -> billing_group_id (parent)
  // fallback : si pas de mapping, billing = teamId
  return map.get(teamId) ?? teamId;
}

export async function generateStatementsAtomicTx(
  client: any,
  args: {
    origin: string;
    paymentListId: string;
    groupStructureId: string;
    subscriptionIds: string[];
  }
) {
  // 1) fetch toutes les subscriptions
  const res = await fetch(`${args.origin}/api/subscriptions/all`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`/api/subscriptions/all returned ${res.status}`);

  const data = await res.json();
  const all = (Array.isArray(data?.items) ? data.items : []) as FlattenedSub[];

  const wanted = new Set(args.subscriptionIds);
  const rows = all.filter((x) => x?.subscriptionId && wanted.has(x.subscriptionId));

  if (!rows.length) throw new Error('No matching subscriptions found in /api/subscriptions/all');

  // 0) Charger la group structure active (info) + son mapping
  // ⚠️ On utilise la version stockée sur le Payment List (args.groupStructureId) pour l’audit.
  // On charge quand même la "active" pour debug/cohérence.
  const activeId = await fetchActiveGroupStructureId(args.origin);

  const usedGroupStructureId = args.groupStructureId; // source de vérité : snapshot du payment list
  if (activeId !== usedGroupStructureId) {
    // Pas bloquant, mais utile en debug (ex: tu génères avec une ancienne version)
    console.warn('[entryFees] group-structure mismatch:', { activeId, usedGroupStructureId });
  }

  const mapPayload = await fetchGroupStructureMap(args.origin, usedGroupStructureId);

  const billingBySource = new Map<string, string>();
  for (const m of mapPayload.mappings ?? []) {
    if (m?.source_group_id && m?.billing_group_id) {
      billingBySource.set(m.source_group_id, m.billing_group_id);
    }
  }


  // 2) validations strictes : currency + teamId + entry_fees_amount
  for (const s of rows) {
    if (!s.amountCurrency) throw new Error(`BAD_REQUEST_MISSING_CURRENCY subscriptionId=${s.subscriptionId}`);
    if (!s.teamId) throw new Error(`BAD_REQUEST_MISSING_TEAM_ID subscriptionId=${s.subscriptionId}`);
    getEntryFeesAmountAllowZero(s); // valide (>=0)
  }

  // 3) lines snapshot
  const lines: Array<{
    subscription_id: string;
    currency: string;
    group_key: string;
    snapshot_total_amount: string;
  }> = [];

  for (const s of rows) {
    const subscription_id = s.subscriptionId!;
    const currency = s.amountCurrency!.trim();

    const teamId = s.teamId!;
    const group_key = computeBillingGroupKey(teamId, billingBySource);

    const amount = getEntryFeesAmountAllowZero(s);

    lines.push({
      subscription_id,
      currency,
      group_key,
      snapshot_total_amount: amount.toFixed(2),
    });
  }


  // 4) group (group_key, currency) => statements
  const groupMap = new Map<string, { group_key: string; currency: string; total: number }>();

  for (const l of lines) {
    const key = `${l.group_key}__${l.currency}`;
    const g = groupMap.get(key) ?? { group_key: l.group_key, currency: l.currency, total: 0 };
    g.total += Number(l.snapshot_total_amount);
    groupMap.set(key, g);
  }

  const sortedGroups = sortStatementGroups(Array.from(groupMap.values()));
  const statements = sortedGroups.map((g, idx) => ({
    group_key: g.group_key,
    currency: g.currency,
    statement_number: buildStatementNumber(args.paymentListId, g.currency, idx),
    total_amount: g.total.toFixed(2),
  }));

  // 5) insert DB atomique avec le MEME client
  return createStatementsAndLinesTx(client, {
    paymentListId: args.paymentListId,
    snapshotSourceGroupId: usedGroupStructureId, // ✅ on snapshotte la version utilisée
    statements,
    lines,
  });

}
