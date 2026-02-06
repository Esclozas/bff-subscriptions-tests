import { getStatement, getStatementLines } from './db';
import { loadAllFlattenedSubscriptions } from '@/modules/subscriptions/subscriptions';
import { getGroupStructureMap } from '@/modules/grouping/db';
import { fetchAllTeamsFromReq, indexTeamsById } from '@/modules/teams/client';

export type NoticeTotals = {
  entryFeesTotal: string;
  subscriptionsCount: number;
};

export type NoticeStatus = 'FINAL' | 'DRAFT';

export type NoticeHeader = {
  statementId: string | null;
  paymentListId: string | null;
  number: string;
  issueDate: string;
  currency: string;
  groupKey: string;
  groupStructureId: string | null;
  issueStatus: string | null;
  paymentStatus: string | null;
  status: NoticeStatus;
  totals: NoticeTotals;
};

export type DistributorInfo = {
  id: string | null;
  name: string | null;
  resolvedBy: 'group_structure_map' | 'fallback_source_group';
  sourceGroup: { id: string | null; name: string | null } | null;
};

export type FundPartTotals = {
  entryFeesTotal: string;
  subscriptionsCount: number;
};

export type FundPartSubscription = {
  subscriptionId: string;
  operationId: string | null;
  investorName: string | null;
  signatureDate: string | null;
  entryFeeAmount: string;
};

export type FundPartGroup = {
  fundId: string | null;
  fundName: string | null;
  partId: string | null;
  partName: string | null;
  isin: string | null;
  totals: FundPartTotals;
  subscriptions: FundPartSubscription[];
};

export type StatementNotice = {
  notice: NoticeHeader;
  distributor: DistributorInfo;
  fundParts: FundPartGroup[];
};

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

function sanitizeFilePart(value: string | null | undefined) {
  if (!value) return '';
  return value
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildNoticeFileName(notice: NoticeHeader, distributor: DistributorInfo) {
  const datePart = formatDateYYYYMMDD(notice.issueDate) || formatDateYYYYMMDD(null);
  const numberPart = sanitizeFilePart(notice.number) || sanitizeFilePart(notice.statementId) || 'notice';
  const groupPart =
    sanitizeFilePart(distributor.name) ||
    sanitizeFilePart(distributor.id) ||
    sanitizeFilePart(notice.groupKey) ||
    'group';

  return `${datePart}_${numberPart}_${groupPart}.pdf`;
}

export async function buildStatementNotice(req: Request, statementId: string) {
  const statement = await getStatement(statementId);
  if (!statement) return null;

  const lines = await getStatementLines(statementId);

  const cookie = cookieHeaderFrom(req);
  const flattened = await loadAllFlattenedSubscriptions(cookie);
  const subsById = new Map(
    flattened
      .filter((s) => typeof s.subscriptionId === 'string' && s.subscriptionId)
      .map((s) => [s.subscriptionId as string, s]),
  );

  const fundPartsByKey = new Map<string, FundPartGroup & { _total: number }>();
  let sourceGroup: { id: string | null; name: string | null } | null = null;

  for (const line of lines) {
    const sub = subsById.get(line.subscription_id) ?? null;
    const entryFeeAmount = toAmountString(line.snapshot_total_amount);

    const fundId = sub?.fundId ?? null;
    const fundName = sub?.fundName ?? null;
    const partId = sub?.partId ?? null;
    const partName = sub?.partName ?? null;

    const key = `${fundId ?? ''}|${partId ?? ''}|${fundName ?? ''}|${partName ?? ''}`;
    const existing =
      fundPartsByKey.get(key) ??
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
      subscriptionId: line.subscription_id,
      operationId: sub?.operationId ?? null,
      investorName: sub?.investorName ?? null,
      signatureDate: sub?.validationDate ?? null,
      entryFeeAmount,
    });

    existing._total += toAmountNumber(line.snapshot_total_amount);
    existing.totals.subscriptionsCount += 1;
    fundPartsByKey.set(key, existing);

    if (!sourceGroup && (sub?.teamId || sub?.teamName)) {
      sourceGroup = { id: sub?.teamId ?? null, name: sub?.teamName ?? null };
    }
  }

  const fundParts = Array.from(fundPartsByKey.values())
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
    .sort((a, b) => (a.fundName ?? '').localeCompare(b.fundName ?? '') || (a.partName ?? '').localeCompare(b.partName ?? ''));

  const notice: NoticeHeader = {
    statementId: statement.id,
    paymentListId: statement.entry_fees_payment_list_id,
    number: statement.statement_number,
    issueDate: statement.created_at,
    currency: statement.currency,
    groupKey: statement.group_key,
    groupStructureId: statement.group_structure_id ?? null,
    issueStatus: statement.issue_status,
    paymentStatus: statement.payment_status,
    status: 'FINAL',
    totals: {
      entryFeesTotal: toAmountString(statement.total_amount),
      subscriptionsCount: statement.subscriptions_count ?? lines.length,
    },
  };

  const teams = await fetchAllTeamsFromReq(req).catch(() => []);
  const teamsById = indexTeamsById(teams);

  let resolvedBy: DistributorInfo['resolvedBy'] = 'fallback_source_group';
  let distributorId = notice.groupKey || sourceGroup?.id || null;
  let distributorName = distributorId ? teamsById.get(distributorId)?.name ?? null : null;

  if (notice.groupStructureId && sourceGroup?.id) {
    const mappings = await getGroupStructureMap(notice.groupStructureId).catch(() => []);
    const mapping = mappings.find((m) => m.source_group_id === sourceGroup?.id);
    if (mapping) {
      resolvedBy = 'group_structure_map';
      distributorId = mapping.billing_group_id ?? distributorId;
      distributorName = teamsById.get(distributorId ?? '')?.name ?? distributorName;
    }
  }

  if (sourceGroup?.id) {
    sourceGroup = {
      id: sourceGroup.id,
      name: teamsById.get(sourceGroup.id)?.name ?? sourceGroup.name ?? null,
    };
  }

  if (!distributorName && sourceGroup?.name) {
    distributorName = sourceGroup.name;
    resolvedBy = 'fallback_source_group';
  }

  const distributor: DistributorInfo = {
    id: distributorId,
    name: distributorName,
    resolvedBy,
    sourceGroup,
  };

  return { notice, distributor, fundParts } satisfies StatementNotice;
}
