export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { getPaymentList, getPaymentListEvents, insertPaymentListEvent } from '@/modules/entryFees/payment-lists/db';

type Ctx = { params: Promise<{ id: string }> };

const CreateEventSchema = z.object({
  currency: z.string().min(1),
  amount_delta: z.string().min(1), // ex "-120.00"
  reason: z.string().min(1).optional(),
  statement_id: z.string().uuid().optional(),
});


function isNegativeDecimalString(s: string) {
  const n = Number(s);
  return Number.isFinite(n) && n < 0;
}

export async function GET(req: NextRequest, context: Ctx) {
  const { id } = await context.params;

  const pl = await getPaymentList(id);
  if (!pl) return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));

  const events = await getPaymentListEvents(id);
  return withCors(NextResponse.json({ paymentListId: id, items: events, total: events.length }));
}

export async function POST(req: NextRequest, context: Ctx) {
  const { id } = await context.params;

  const pl = await getPaymentList(id);
  if (!pl) return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));

  const raw = await req.json().catch(() => ({}));
  const parsed = CreateEventSchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
    );
  }

  const body = parsed.data;

  if (!isNegativeDecimalString(body.amount_delta)) {
    return withCors(
      NextResponse.json({ message: 'amount_delta must be a negative number' }, { status: 400 }),
    );
  }

  // Optionnel mais recommandé
  if (body.statement_id && !body.reason) {
    return withCors(
      NextResponse.json(
        { message: 'reason is required when statement_id is provided' },
        { status: 400 },
      ),
    );
  }

  try {
    const saved = await insertPaymentListEvent({
      paymentListId: id,
      currency: body.currency,
      amount_delta: body.amount_delta,
      reason: body.reason ?? null,
      statement_id: body.statement_id ?? null,
    });

    return withCors(NextResponse.json(saved, { status: 201 }));
  } catch (err: any) {
    const msg = String(err?.message ?? err);

    // Index unique DB => 409 si doublon
    if (msg.includes('uq_payment_list_event_statement')) {
      return withCors(
        NextResponse.json(
          {
            message: 'Event already exists for this statement',
            statement_id: body.statement_id ?? null,
          },
          { status: 409 },
        ),
      );
    }

    console.error('POST /api/entry-fees/payment-lists/[id]/events failed', { reason: msg });
    return withCors(
      NextResponse.json({ message: 'DB failure on insert event', detail: msg }, { status: 500 }),
    );
  }
}