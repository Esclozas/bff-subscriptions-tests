import type { Flattened } from '@/modules/subscriptions/flatten';
import { loadAllFlattenedSubscriptions } from '@/modules/subscriptions/subscriptions';
import { getActiveGroupStructure, getGroupStructureMap } from '@/modules/grouping/db';
import { fetchAllTeamsFromReq, indexTeamsById } from '@/modules/teams/client';
import type { FundPartGroup, StatementNotice } from '@/modules/entryFees/Statements/notice';

type DraftNoticesArgs = {
  subscriptionIds: string[];
  groupStructureId?: string | null;
  issueDate?: string | null;
};

type DraftNoticesResult = {
  groupStructureId: string;
  notices: StatementNotice[];
};

type DraftNoticeGroup = {
  groupKey: string;
  currency: string;
  total: number;
  subscriptionsCount: number;
  fundParts: Map<string, FundPartGroup & { _total: number }>;
  sourceGroup: { id: string | null; name: string | null } | null;
  mappingUsed: boolean;
};

function badRequest(message: string, details?: Record<string, unknown>) {
  const err = new Error(message);
  (err as any).details = details;
  return err;
}

function cookieHeaderFrom(req: Request) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

function toAmountNumber(value: string | number | null | undefined) {
  if (value == null) return 0;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function toAmountString(value: string | number | null | undefined) {
  return toAmountNumber(value).toFixed(2);
}

function formatDateYYYYMMDD(value: string | null | undefined) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function normalizeIssueDate(value?: string | null) {
  if (!value) return new Date().toISOString();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return new Date().toISOString();
  return d.toISOString();
}

function computeBillingGroupKey(teamId: string, map: Map<string, string>) {
  return map.get(teamId) ?? teamId;
}

function getEntryFeesAmountAllowZero(sub: Flattened) {
  const v = Number(sub.entry_fees_amount);
  if (!Number.isFinite(v) || v < 0) {
    throw badRequest('BAD_REQUEST_INVALID_ENTRY_FEES_AMOUNT', {
      subscription_id: sub.subscriptionId,
      entry_fees_amount: sub.entry_fees_amount,
    });
  }
  return v;
}

function buildDraftNoticeNumber(groupKey: string, currency: string, index: number, issueDate: string) {
  const datePart = formatDateYYYYMMDD(issueDate) || formatDateYYYYMMDD(null);
  const groupPart = groupKey ? groupKey.slice(0, 8) : 'group';
  return `DRAFT-${datePart}-${groupPart}-${currency}-${index + 1}`;
}

export async function buildDraftNotices(req: Request, args: DraftNoticesArgs): Promise<DraftNoticesResult> {
  const cookie = cookieHeaderFrom(req);
  const flattened = await loadAllFlattenedSubscriptions(cookie);

  const wanted = Array.from(new Set(args.subscriptionIds));
  const subsById = new Map(
    flattened
      .filter((s) => typeof s.subscriptionId === 'string' && s.subscriptionId)
      .map((s) => [s.subscriptionId as string, s]),
  );

  const missing = wanted.filter((id) => !subsById.has(id));
  if (missing.length) {
    throw badRequest('BAD_REQUEST_SUBSCRIPTIONS_NOT_FOUND', {
      missing_subscription_ids: missing,
    });
  }

  const active = args.groupStructureId
    ? { id: args.groupStructureId }
    : await getActiveGroupStructure();

  if (!active?.id) {
    throw badRequest('BAD_REQUEST_GROUP_STRUCTURE_MISSING');
  }

  const groupStructureId = active.id;
  const mappings = await getGroupStructureMap(groupStructureId).catch(() => []);
  const billingBySource = new Map<string, string>();
  for (const m of mappings) {
    if (m?.source_group_id && m?.billing_group_id) {
      billingBySource.set(m.source_group_id, m.billing_group_id);
    }
  }

  const teams = await fetchAllTeamsFromReq(req).catch(() => []);
  const teamsById = indexTeamsById(teams);

  const groups = new Map<string, DraftNoticeGroup>();
  const issueDate = normalizeIssueDate(args.issueDate ?? null);

  for (const id of wanted) {
    const sub = subsById.get(id)!;
    const currency = sub.amountCurrency?.trim();
    if (!currency) {
      throw badRequest('BAD_REQUEST_MISSING_CURRENCY', { subscription_id: sub.subscriptionId });
    }
    if (!sub.teamId) {
      throw badRequest('BAD_REQUEST_MISSING_TEAM_ID', { subscription_id: sub.subscriptionId });
    }

    const amount = getEntryFeesAmountAllowZero(sub);
    const groupKey = computeBillingGroupKey(sub.teamId, billingBySource);
    const groupIndex = `${groupKey}__${currency}`;

    const group =
      groups.get(groupIndex) ??
      ({
        groupKey,
        currency,
        total: 0,
        subscriptionsCount: 0,
        fundParts: new Map(),
        sourceGroup: null,
        mappingUsed: false,
      } as DraftNoticeGroup);

    group.total += amount;
    group.subscriptionsCount += 1;
    group.mappingUsed = group.mappingUsed || billingBySource.has(sub.teamId);

    if (!group.sourceGroup) {
      const nameFromTeams = teamsById.get(sub.teamId)?.name ?? null;
      group.sourceGroup = {
        id: sub.teamId ?? null,
        name: nameFromTeams ?? sub.teamName ?? null,
      };
    }

    const fundId = sub.fundId ?? null;
    const fundName = sub.fundName ?? null;
    const partId = sub.partId ?? null;
    const partName = sub.partName ?? null;
    const key = `${fundId ?? ''}|${partId ?? ''}|${fundName ?? ''}|${partName ?? ''}`;

    const existing =
      group.fundParts.get(key) ??
      ({
        fundId,
        fundName,
        partId,
        partName,
        isin: null,
        totals: { entryFeesTotal: '0.00', subscriptionsCount: 0 },
        subscriptions: [],
        _total: 0,
      } as FundPartGroup & { _total: number });

    existing.subscriptions.push({
      subscriptionId: sub.subscriptionId as string,
      investorName: sub.investorName ?? null,
      signatureDate: sub.validationDate ?? null,
      entryFeeAmount: toAmountString(amount),
    });

    existing._total += amount;
    existing.totals.subscriptionsCount += 1;
    group.fundParts.set(key, existing);

    groups.set(groupIndex, group);
  }

  const notices = Array.from(groups.values())
    .sort(
      (a, b) =>
        a.groupKey.localeCompare(b.groupKey) ||
        a.currency.localeCompare(b.currency),
    )
    .map((group, index) => {
      const fundParts = Array.from(group.fundParts.values())
        .map((g) => ({
          fundId: g.fundId,
          fundName: g.fundName,
          partId: g.partId,
          partName: g.partName,
          isin: g.isin,
          totals: {
            entryFeesTotal: g._total.toFixed(2),
            subscriptionsCount: g.totals.subscriptionsCount,
          },
          subscriptions: g.subscriptions,
        }))
        .sort(
          (a, b) =>
            (a.fundName ?? '').localeCompare(b.fundName ?? '') ||
            (a.partName ?? '').localeCompare(b.partName ?? ''),
        );

      const noticeNumber = buildDraftNoticeNumber(
        group.groupKey,
        group.currency,
        index,
        issueDate,
      );

      let sourceGroup = group.sourceGroup;
      if (sourceGroup?.id) {
        sourceGroup = {
          id: sourceGroup.id,
          name: teamsById.get(sourceGroup.id)?.name ?? sourceGroup.name ?? null,
        };
      }

      const distributorId = group.groupKey || sourceGroup?.id || null;
      let distributorName = distributorId
        ? teamsById.get(distributorId)?.name ?? null
        : null;

      let resolvedBy: StatementNotice['distributor']['resolvedBy'] =
        group.mappingUsed ? 'group_structure_map' : 'fallback_source_group';

      if (!distributorName && sourceGroup?.name) {
        distributorName = sourceGroup.name;
        resolvedBy = 'fallback_source_group';
      }

      return {
        notice: {
          statementId: null,
          paymentListId: null,
          number: noticeNumber,
          issueDate,
          currency: group.currency,
          groupKey: group.groupKey,
          groupStructureId,
          issueStatus: null,
          paymentStatus: null,
          status: 'DRAFT',
          totals: {
            entryFeesTotal: group.total.toFixed(2),
            subscriptionsCount: group.subscriptionsCount,
          },
        },
        distributor: {
          id: distributorId,
          name: distributorName,
          resolvedBy,
          sourceGroup,
        },
        fundParts,
      } satisfies StatementNotice;
    });

  return { groupStructureId, notices };
}
