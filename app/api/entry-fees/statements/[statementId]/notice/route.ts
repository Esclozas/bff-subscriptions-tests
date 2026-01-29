export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { buildStatementNotice } from '@/modules/entryFees/Statements/notice';

type Ctx = { params: Promise<{ statementId: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const notice = await buildStatementNotice(req, statementId);
  if (!notice) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }

  return withCors(NextResponse.json(notice));
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
