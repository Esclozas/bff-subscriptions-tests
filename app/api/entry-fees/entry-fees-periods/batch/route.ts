export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { applyEntryFeesPeriodBatch } from '@/modules/entryFees/entry-fees-period/db';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UuidSchema = z.string().uuid();

const CreateItemSchema = z.object({
  start_date: DateSchema,
  end_date: DateSchema,
});

const UpdateItemSchema = z.object({
  id: UuidSchema,
  start_date: DateSchema,
  end_date: DateSchema,
});

const DeleteItemSchema = z.object({
  id: UuidSchema,
});

const BatchBodySchema = z
  .object({
    create: z.array(CreateItemSchema).optional().default([]),
    update: z.array(UpdateItemSchema).optional().default([]),
    delete: z.array(DeleteItemSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    data.create.forEach((item, index) => {
      if (item.start_date >= item.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid range: start_date must be < end_date',
          path: ['create', index, 'start_date'],
        });
      }
    });

    data.update.forEach((item, index) => {
      if (item.start_date >= item.end_date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid range: start_date must be < end_date',
          path: ['update', index, 'start_date'],
        });
      }
    });

    const updateIds = data.update.map((item) => item.id);
    const deleteIds = data.delete.map((item) => item.id);

    if (new Set(updateIds).size !== updateIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate ids in update[]',
        path: ['update'],
      });
    }

    if (new Set(deleteIds).size !== deleteIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate ids in delete[]',
        path: ['delete'],
      });
    }

    const deleteIdSet = new Set(deleteIds);
    const collisionIds = updateIds.filter((id) => deleteIdSet.has(id));
    if (collisionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Same id cannot be in both update[] and delete[]',
        path: ['update'],
      });
    }
  });

function isPgOverlapError(err: any) {
  // Exclusion violation (EXCLUDE USING gist) = 23P01
  return String(err?.code ?? '').toUpperCase() === '23P01';
}

function isPeriodNotFoundError(err: any) {
  return String(err?.code ?? '').toUpperCase() === 'PERIOD_NOT_FOUND';
}

function buildBatchError(err: any) {
  const ctx = err?._batch;
  const op = ctx?.op ?? 'batch';
  const index = Number.isFinite(ctx?.index) ? ctx.index : -1;

  if (isPgOverlapError(err)) {
    return { op, index, code: 'PERIOD_OVERLAP', message: 'Period overlaps an existing one' };
  }
  if (isPeriodNotFoundError(err)) {
    return { op, index, code: 'PERIOD_NOT_FOUND', message: 'Period not found' };
  }
  return { op, index, code: 'INTERNAL_ERROR', message: String(err?.message ?? err) };
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = BatchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const results = await applyEntryFeesPeriodBatch(parsed.data);
    return withCors(NextResponse.json({ ok: true, results, errors: [] }));
  } catch (err: any) {
    const error = buildBatchError(err);
    const emptyResults = { create: [], update: [], delete: [] };

    if (isPgOverlapError(err)) {
      return withCors(
        NextResponse.json(
          { ok: false, code: 'PERIOD_OVERLAP', message: error.message, results: emptyResults, errors: [error] },
          { status: 409 },
        ),
      );
    }

    if (isPeriodNotFoundError(err)) {
      return withCors(
        NextResponse.json(
          { ok: false, code: 'PERIOD_NOT_FOUND', message: error.message, results: emptyResults, errors: [error] },
          { status: 404 },
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
