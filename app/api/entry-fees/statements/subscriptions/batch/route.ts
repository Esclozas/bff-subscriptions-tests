export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { getStatementLinesByStatementIds, getStatementsMetaByIds } from '@/modules/entryFees/Statements/db';
import { getGroupStructureMap } from '@/modules/grouping/db';
import { loadAllFlattenedSubscriptions } from '@/modules/subscriptions/subscriptions';
import { fetchAllTeamsFromReq, indexTeamsById } from '@/modules/teams/client';

const BodySchema = z
  .object({
    statement_ids: z.array(z.string().uuid()).min(1).max(100),
  })
  .superRefine((data, ctx) => {
    if (new Set(data.statement_ids).size !== data.statement_ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate ids in statement_ids[]',
        path: ['statement_ids'],
      });
    }
  });

function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) {
    return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  }
  return '';
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
    );
  }

  const statementIds = parsed.data.statement_ids;
  const lines = await getStatementLinesByStatementIds(statementIds);
  const statementsMeta = await getStatementsMetaByIds(statementIds);

  const cookie = cookieHeaderFrom(req);
  const subscriptions = await loadAllFlattenedSubscriptions(cookie);
  const subscriptionsById = new Map<string, (typeof subscriptions)[number]>();
  for (const sub of subscriptions) {
    if (sub.subscriptionId) subscriptionsById.set(sub.subscriptionId, sub);
  }

  const metaByStatementId = new Map<
    string,
    { group_key: string | null; group_structure_id: string | null }
  >();
  for (const m of statementsMeta) {
    metaByStatementId.set(m.id, {
      group_key: m.group_key ?? null,
      group_structure_id: m.group_structure_id ?? null,
    });
  }

  const groupStructureIds = Array.from(
    new Set(statementsMeta.map((m) => m.group_structure_id).filter(Boolean)),
  ) as string[];

  const billingBySourceByStructure = new Map<string, Map<string, string>>();
  for (const id of groupStructureIds) {
    let mappings: Array<{ source_group_id: string; billing_group_id: string }> = [];
    try {
      mappings = await getGroupStructureMap(id);
    } catch {
      mappings = [];
    }
    const map = new Map<string, string>();
    for (const m of mappings) {
      if (m?.source_group_id && m?.billing_group_id) {
        map.set(m.source_group_id, m.billing_group_id);
      }
    }
    billingBySourceByStructure.set(id, map);
  }

  let teamsById = new Map<string, { id: string; name: string | null }>();
  try {
    const teams = await fetchAllTeamsFromReq(req);
    teamsById = indexTeamsById(teams);
  } catch {
    teamsById = new Map();
  }

  const byStatementId: Record<string, { items: any[]; total: number }> = {};
  for (const id of statementIds) {
    byStatementId[id] = { items: [], total: 0 };
  }

  for (const line of lines) {
    const sub = subscriptionsById.get(line.subscription_id) ?? null;
    const meta = metaByStatementId.get(line.entry_fees_statement_id) ?? null;
    const sourceGroupId = line.snapshot_source_group_id ?? null;
    const groupStructureId = meta?.group_structure_id ?? null;
    const billingBySource = groupStructureId
      ? billingBySourceByStructure.get(groupStructureId) ?? null
      : null;
    const resolvedBillingGroupId =
      meta?.group_key ??
      (sourceGroupId ? billingBySource?.get(sourceGroupId) ?? null : null) ??
      sourceGroupId ??
      null;

    const sourceGroupName =
      sourceGroupId
        ? teamsById.get(sourceGroupId)?.name ?? sub?.teamName ?? null
        : sub?.teamName ?? null;
    const billingGroupName =
      resolvedBillingGroupId
        ? teamsById.get(resolvedBillingGroupId)?.name ??
          (resolvedBillingGroupId === sourceGroupId ? sourceGroupName : null)
        : null;

    const item = {
      id: line.id,
      entry_fees_statement_id: line.entry_fees_statement_id,
      subscription_id: line.subscription_id,
      snapshot_source_group_id: line.snapshot_source_group_id,
      source_group_id: sourceGroupId,
      group_name: sourceGroupName,
      billing_group_id: resolvedBillingGroupId,
      billing_group_name: billingGroupName,
      snapshot_total_amount: line.snapshot_total_amount,
      operation_id: sub?.operationId ?? null,
      investor_name: sub?.investorName ?? null,
      investor_first_name: sub?.investorFirstName ?? null,
      fund_name: sub?.fundName ?? null,
      product_name: sub?.productName ?? null,
      team_id: sub?.teamId ?? null,
      team_name: sub?.teamName ?? null,
      part_name: sub?.partName ?? null,
      owner_full_name: sub?.ownerFullName ?? null,
      validation_date: sub?.validationDate ?? null,
      amount_value: sub?.amountValue ?? null,
      amount_currency: sub?.amountCurrency ?? null,
      entry_fees_percent: sub?.entry_fees_percent ?? null,
      entry_fees_amount: sub?.entry_fees_amount ?? null,
      entry_fees_amount_total: sub?.entry_fees_amount_total ?? null,
    };

    if (!byStatementId[line.entry_fees_statement_id]) {
      byStatementId[line.entry_fees_statement_id] = { items: [], total: 0 };
    }
    byStatementId[line.entry_fees_statement_id].items.push(item);
  }

  for (const id of Object.keys(byStatementId)) {
    byStatementId[id].total = byStatementId[id].items.length;
  }

  return withCors(
    NextResponse.json({
      by_statement_id: byStatementId,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
