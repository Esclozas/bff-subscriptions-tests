export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { listStatementsByPaymentListId } from '@/modules/entryFees/payment-lists/statements_db';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;

  const items = await listStatementsByPaymentListId(id);

  return withCors(
    NextResponse.json({
      paymentListId: id,
      items,
      total: items.length,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
