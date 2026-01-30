export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { buildDraftNotices } from '@/modules/entryFees/payment-lists/notice_preview';

const SnapshotSchema = z.object({
  subscriptionId: z.string().uuid(),
  teamId: z.string().uuid().nullable(),
  teamName: z.string().nullable().optional(),
  amountCurrency: z.string().nullable(),
  entry_fees_amount: z.coerce.number().nullable(),
  fundId: z.string().uuid().nullable().optional(),
  fundName: z.string().nullable().optional(),
  partId: z.string().uuid().nullable().optional(),
  partName: z.string().nullable().optional(),
  investorName: z.string().nullable().optional(),
  validationDate: z.string().nullable().optional(),
});

const BodySchema = z.object({
  subscription_snapshots: z.array(SnapshotSchema).min(1).max(500),
  group_structure_id: z.string().uuid().optional(),
  payment_list_id: z.string().uuid().optional(),
  skip_team_lookup: z.boolean().optional(),
  issue_date: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const { notices, groupStructureId, paymentListId } = await buildDraftNotices(req, {
      subscriptionSnapshots: parsed.data.subscription_snapshots,
      groupStructureId: parsed.data.group_structure_id ?? null,
      paymentListId: parsed.data.payment_list_id ?? null,
      skipTeamLookup: parsed.data.skip_team_lookup ?? false,
      issueDate: parsed.data.issue_date ?? null,
    });

    return withCors(
      NextResponse.json({
        group_structure_id: groupStructureId,
        payment_list_id: paymentListId,
        notices,
      }),
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const details = err?.details ?? null;

    if (msg.startsWith('BAD_REQUEST_')) {
      return withCors(
        NextResponse.json(
          { message: msg, ...(details ?? {}) },
          { status: 400 },
        ),
      );
    }

    console.error('POST /api/entry-fees/payment-lists/notices/preview failed', { reason: msg });

    return withCors(
      NextResponse.json(
        { message: 'Internal Server Error', detail: msg },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
