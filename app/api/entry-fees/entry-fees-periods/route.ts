export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { createPeriod, listPeriods } from '@/modules/entryFees/entry-fees-period/db';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateBodySchema = z.object({
  start_date: DateSchema,
  end_date: DateSchema,
  // created_by: z.string().optional(), // si tu ajoutes la colonne plus tard
});

function isPgOverlapError(err: any) {
  // Exclusion violation (EXCLUDE USING gist) = 23P01
  return String(err?.code ?? '').toUpperCase() === '23P01';
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const limit = Number(url.searchParams.get('limit') ?? '200');
    const cursor = url.searchParams.get('cursor');

    // validation légère query
    if (from && !DateSchema.safeParse(from).success) {
      return withCors(NextResponse.json({ message: 'Invalid from (YYYY-MM-DD expected)' }, { status: 400 }));
    }
    if (to && !DateSchema.safeParse(to).success) {
      return withCors(NextResponse.json({ message: 'Invalid to (YYYY-MM-DD expected)' }, { status: 400 }));
    }

    const { items, nextCursor, total } = await listPeriods({
      from,
      to,
      limit: Number.isFinite(limit) ? limit : 200,
      cursor,
    });

    return withCors(
      NextResponse.json({
        items,
        nextCursor,
        total,
        limit: Math.min(Math.max(Number.isFinite(limit) ? limit : 200, 1), 500),
      }),
    );
  } catch (err: any) {
    return withCors(
      NextResponse.json(
        { message: 'List periods failed', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = CreateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const { start_date, end_date } = parsed.data;

    // start_date <= end_date (inclusive)
    if (start_date > end_date) {
      return withCors(
        NextResponse.json({ message: 'Invalid range: start_date must be <= end_date' }, { status: 400 }),
      );
    }

    const created = await createPeriod({ start_date, end_date });
    return withCors(NextResponse.json(created, { status: 201 }));
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
        { message: 'Create period failed', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
