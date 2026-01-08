export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getPaymentList } from '@/modules/entryFees/payment-lists/db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { id } = await context.params;

  const pl = await getPaymentList(id);
  if (!pl) {
    return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));
  }

  return withCors(NextResponse.json(pl));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
