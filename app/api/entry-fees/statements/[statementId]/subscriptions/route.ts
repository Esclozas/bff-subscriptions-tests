export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getStatement, getStatementLines } from '@/modules/entryFees/Statements/db';

type Ctx = { params: Promise<{ statementId: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const s = await getStatement(statementId);
  if (!s) return withCors(NextResponse.json({ message: 'Not Found' }, { status: 404 }));

  const lines = await getStatementLines(statementId);
  return withCors(NextResponse.json({ items: lines, total: lines.length }));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
