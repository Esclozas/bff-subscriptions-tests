export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getStatement, getStatementLines } from '@/modules/entryFees/Statements/db';

type Ctx = { params: Promise<{ statementId: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const statement = await getStatement(statementId);
  if (!statement) return withCors(NextResponse.json({ message: 'Not Found' }, { status: 404 }));

  const lines = await getStatementLines(statementId);

  const computedLinesTotal = lines.reduce((acc, l) => acc + Number(l.snapshot_total_amount ?? 0), 0);

  return withCors(
    NextResponse.json({
      statement,
      lines,
      totals: {
        statementTotalAmount: Number(statement.total_amount),
        linesTotalAmount: computedLinesTotal,
        linesCount: lines.length,
        // utile UI: flag si incohérence
        mismatch: Number(statement.total_amount) !== computedLinesTotal,
      },
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
