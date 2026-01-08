export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { getPeriodById } from '@/modules/entryFees/entry-fees-period/db';

type Ctx = { params: Promise<{ periodId: string }> };

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

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
