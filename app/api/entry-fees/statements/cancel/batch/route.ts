export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { cancelStatementWithEvent, getStatement } from '@/modules/entryFees/Statements/db';

const BodySchema = z
  .object({
    statement_ids: z.array(z.string().uuid()).min(1).max(100),
    reason: z.string().nullable().optional(),
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

type BatchResult = {
  statement_id: string;
  status: 'CANCELLED' | 'ALREADY_CANCELLED' | 'NOT_FOUND' | 'ERROR';
  payment_list_id?: string | null;
  issue_status?: string | null;
  cancelled_at?: string | null;
  message?: string;
};

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
    );
  }

  const results: BatchResult[] = [];
  const paymentListIds = new Set<string>();

  for (const statementId of parsed.data.statement_ids) {
    try {
      const res = await cancelStatementWithEvent(statementId, parsed.data.reason ?? null);

      if (res?.kind === 'OK') {
        const st = res.statement;
        if (st?.entry_fees_payment_list_id) paymentListIds.add(st.entry_fees_payment_list_id);
        results.push({
          statement_id: statementId,
          status: 'CANCELLED',
          payment_list_id: st?.entry_fees_payment_list_id ?? null,
          issue_status: st?.issue_status ?? null,
          cancelled_at: st?.cancelled_at ?? null,
        });
        continue;
      }

      if (res?.kind === 'ALREADY_CANCELLED') {
        const st = await getStatement(statementId).catch(() => null);
        if (st?.entry_fees_payment_list_id) paymentListIds.add(st.entry_fees_payment_list_id);
        results.push({
          statement_id: statementId,
          status: 'ALREADY_CANCELLED',
          payment_list_id: st?.entry_fees_payment_list_id ?? null,
          issue_status: st?.issue_status ?? null,
          cancelled_at: st?.cancelled_at ?? null,
        });
        continue;
      }

      if (res?.kind === 'NOT_FOUND') {
        results.push({ statement_id: statementId, status: 'NOT_FOUND' });
        continue;
      }

      results.push({ statement_id: statementId, status: 'ERROR', message: 'Cancel failed' });
    } catch (err: any) {
      results.push({
        statement_id: statementId,
        status: 'ERROR',
        message: String(err?.message ?? err),
      });
    }
  }

  const cancelled_count = results.filter((r) => r.status === 'CANCELLED').length;
  const already_cancelled_count = results.filter((r) => r.status === 'ALREADY_CANCELLED').length;
  const not_found_count = results.filter((r) => r.status === 'NOT_FOUND').length;
  const error_count = results.filter((r) => r.status === 'ERROR').length;

  return withCors(
    NextResponse.json({
      done: true,
      cancelled_count,
      already_cancelled_count,
      not_found_count,
      error_count,
      payment_list_ids: Array.from(paymentListIds),
      results,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
