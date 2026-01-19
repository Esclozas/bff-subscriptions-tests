export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { updateStatementsPaymentStatusBatch } from '@/modules/entryFees/Statements/db';

const UpdateSchema = z.object({
  id: z.string().uuid(),
  payment_status: z.enum(['UNPAID', 'PAID']),
});

const BodySchema = z
  .object({
    updates: z.array(UpdateSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const ids = data.updates.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate ids in updates[]',
        path: ['updates'],
      });
    }
  });

function isStatementNotFoundError(err: any) {
  return String(err?.code ?? '').toUpperCase() === 'STATEMENT_NOT_FOUND';
}

function isInvalidTransitionError(err: any) {
  return String(err?.code ?? '').toUpperCase() === 'INVALID_TRANSITION';
}

function buildBatchError(err: any) {
  const ctx = err?._batch;
  const op = ctx?.op ?? 'update';
  const index = Number.isFinite(ctx?.index) ? ctx.index : -1;
  const statement_id = ctx?.id ?? null;

  if (isStatementNotFoundError(err)) {
    return { op, index, statement_id, code: 'STATEMENT_NOT_FOUND', message: 'Statement not found' };
  }
  if (isInvalidTransitionError(err)) {
    return { op, index, statement_id, code: 'INVALID_TRANSITION', message: 'Invalid payment_status transition' };
  }
  return { op, index, statement_id, code: 'INTERNAL_ERROR', message: String(err?.message ?? err) };
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const results = await updateStatementsPaymentStatusBatch(parsed.data.updates);
    return withCors(NextResponse.json({ ok: true, results, errors: [] }));
  } catch (err: any) {
    const error = buildBatchError(err);
    const emptyResults: any[] = [];

    if (isStatementNotFoundError(err)) {
      return withCors(
        NextResponse.json(
          { ok: false, code: 'STATEMENT_NOT_FOUND', message: error.message, results: emptyResults, errors: [error] },
          { status: 404 },
        ),
      );
    }

    if (isInvalidTransitionError(err)) {
      return withCors(
        NextResponse.json(
          { ok: false, code: 'INVALID_TRANSITION', message: error.message, results: emptyResults, errors: [error] },
          { status: 400 },
        ),
      );
    }

    return withCors(
      NextResponse.json(
        {
          ok: false,
          message: 'Batch operation failed',
          detail: String(err?.message ?? err),
          results: emptyResults,
          errors: [error],
        },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
