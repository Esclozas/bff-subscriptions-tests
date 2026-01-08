export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { resolvePeriodByDate } from '@/modules/entryFees/entry-fees-period/db';

const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');

    if (!date || !DateSchema.safeParse(date).success) {
      return withCors(
        NextResponse.json({ message: 'Missing or invalid date (YYYY-MM-DD expected)' }, { status: 400 }),
      );
    }

    const period = await resolvePeriodByDate(date);
    if (!period) {
      return withCors(NextResponse.json({ message: 'No period matches this date', date }, { status: 404 }));
    }

    return withCors(NextResponse.json(period));
  } catch (err: any) {
    return withCors(
      NextResponse.json(
        { message: 'Resolve period failed', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
