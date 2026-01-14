export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { listStatementsBySubscriptionId } from '@/modules/subscriptions/statements';

type Ctx = { params: Promise<{ subscriptionId: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { subscriptionId } = await context.params;

  const isUuid = z.string().uuid().safeParse(subscriptionId).success;
  if (!isUuid) {
    return withCors(
      NextResponse.json({ message: 'Invalid subscriptionId (uuid expected)' }, { status: 400 }),
    );
  }

  const items = await listStatementsBySubscriptionId(subscriptionId);

  return withCors(
    NextResponse.json({
      subscription_id: subscriptionId,
      items,
      total: items.length,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
