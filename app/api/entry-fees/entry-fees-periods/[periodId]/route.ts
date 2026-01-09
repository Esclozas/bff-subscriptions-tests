export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { getPeriodById, deletePeriodById, updatePeriodById } from '@/modules/entryFees/entry-fees-period/db';

type Ctx = { params: Promise<{ periodId: string }> };

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const UpdateBodySchema = z.object({
  start_date: DateSchema,
  end_date: DateSchema,
});

function isPgOverlapError(err: any) {
  // Exclusion violation (EXCLUDE USING gist) = 23P01
  return String(err?.code ?? '').toUpperCase() === '23P01';
}


export async function GET(req: NextRequest, context: Ctx) {
  try {
    const { periodId } = await context.params;

    const isUuid = z.string().uuid().safeParse(periodId).success;
    if (!isUuid) {
      return withCors(NextResponse.json({ message: 'Invalid periodId (uuid expected)' }, { status: 400 }));
    }

    const period = await getPeriodById(periodId);
    if (!period) {
      return withCors(NextResponse.json({ message: 'Not Found', periodId }, { status: 404 }));
    }

    return withCors(NextResponse.json(period));
  } catch (err: any) {
    return withCors(
      NextResponse.json(
        { message: 'Get period failed', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}


export async function PUT(req: NextRequest, context: Ctx) {
  try {
    const { periodId } = await context.params;

    const isUuid = z.string().uuid().safeParse(periodId).success;
    if (!isUuid) {
      return withCors(
        NextResponse.json({ message: 'Invalid periodId (uuid expected)' }, { status: 400 }),
      );
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = UpdateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const { start_date, end_date } = parsed.data;

    // Validation métier
    if (start_date >= end_date) {
      return withCors(
        NextResponse.json({ message: 'Invalid range: start_date must be < end_date' }, { status: 400 }),
      );
    }

    const updated = await updatePeriodById(periodId, { start_date, end_date });
    if (!updated) {
      return withCors(
        NextResponse.json({ message: 'Not Found', periodId }, { status: 404 }),
      );
    }

    return withCors(NextResponse.json(updated));
  } catch (err: any) {
    if (isPgOverlapError(err)) {
      return withCors(
        NextResponse.json(
          {
            message: 'Period overlaps an existing one',
            code: 'PERIOD_OVERLAP',
            detail: String(err?.detail ?? err?.message ?? err),
          },
          { status: 409 },
        ),
      );
    }

    return withCors(
      NextResponse.json(
        { message: 'Update period failed', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}


export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function DELETE(req: NextRequest, context: Ctx) {
  try {
    const { periodId } = await context.params;

    const isUuid = z.string().uuid().safeParse(periodId).success;
    if (!isUuid) {
      return withCors(
        NextResponse.json({ message: 'Invalid periodId (uuid expected)' }, { status: 400 }),
      );
    }

    const deletedId = await deletePeriodById(periodId);
    if (!deletedId) {
      return withCors(
        NextResponse.json({ message: 'Not Found', periodId }, { status: 404 }),
      );
    }

    return withCors(new NextResponse(null, { status: 204 }));
  } catch (err: any) {
    return withCors(
      NextResponse.json(
        { message: 'Delete period failed', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}
