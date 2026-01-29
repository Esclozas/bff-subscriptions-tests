export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { buildDraftNotices } from '@/modules/entryFees/payment-lists/notice_preview';

const BodySchema = z.object({
  subscription_ids: z.array(z.string().uuid()).min(1).max(500),
  group_structure_id: z.string().uuid().optional(),
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

    const { notices, groupStructureId } = await buildDraftNotices(req, {
      subscriptionIds: parsed.data.subscription_ids,
      groupStructureId: parsed.data.group_structure_id ?? null,
      issueDate: parsed.data.issue_date ?? null,
    });

    return withCors(
      NextResponse.json({
        group_structure_id: groupStructureId,
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
