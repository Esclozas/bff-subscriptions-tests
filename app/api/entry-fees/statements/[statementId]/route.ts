export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { z } from 'zod';
import { getStatement, updateStatementPaymentStatus } from '@/modules/entryFees/Statements/db';
import {
  assertValidPaymentStatus,
  canTransitionPaymentStatus,
  type PaymentStatus,
} from '@/modules/entryFees/Statements/status';

type Ctx = { params: Promise<{ statementId: string }> };

const PatchSchema = z.object({
  payment_status: z.string(),
});

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const s = await getStatement(statementId);
  if (!s) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }
  return withCors(NextResponse.json(s));
}

/**
 * PATCH { payment_status }
 * - seul champ modifiable
 * - applique machine d'état (UNPAID -> PAID)
 */
export async function PATCH(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const s = await getStatement(statementId);
  if (!s) return withCors(NextResponse.json({ message: 'Not Found' }, { status: 404 }));

  const raw = await req.json().catch(() => ({}));
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }));
  }

  const next = assertValidPaymentStatus(parsed.data.payment_status);
  if (!next) {
    return withCors(NextResponse.json({ message: 'Invalid payment_status' }, { status: 400 }));
  }

  const from = s.payment_status as PaymentStatus;
  if (from === next) {
    return withCors(NextResponse.json(s)); // idempotent
  }

  if (!canTransitionPaymentStatus(from, next)) {
    return withCors(
      NextResponse.json({ message: 'Forbidden transition', from, to: next }, { status: 400 }),
    );
  }

  const updated = await updateStatementPaymentStatus(statementId, next);
  return withCors(NextResponse.json(updated ?? {}));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
