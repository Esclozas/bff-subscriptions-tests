export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { z } from 'zod';
import { getStatement, updateStatementStatus } from '@/modules/entryFees/Statements/db';
import { assertValidStatus, canTransition, type StatementStatus } from '@/modules/entryFees/Statements/status';

type Ctx = { params: Promise<{ statementId: string }> };

const PatchSchema = z.object({
  status: z.string(),
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
 * PATCH { status }
 * - seul champ modifiable
 * - applique machine d'état
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

  const next = assertValidStatus(parsed.data.status);
  if (!next) return withCors(NextResponse.json({ message: 'Invalid status' }, { status: 400 }));

  const from = s.status as StatementStatus;
  if (from === next) {
    return withCors(NextResponse.json(s)); // idempotent
  }

  if (!canTransition(from, next)) {
    return withCors(
      NextResponse.json({ message: 'Forbidden transition', from, to: next }, { status: 400 }),
    );
  }

  // Protection: on ne permet pas PATCH -> CANCELLED, tu as un endpoint action dédié
  if (next === 'CANCELLED') {
    return withCors(
      NextResponse.json({ message: 'Use /cancel endpoint to cancel a statement' }, { status: 400 }),
    );
  }

  const updated = await updateStatementStatus(statementId, next);
  return withCors(NextResponse.json(updated ?? {}));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
