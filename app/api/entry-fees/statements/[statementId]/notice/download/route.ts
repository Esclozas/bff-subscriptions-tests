export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { buildNoticeFileName, buildStatementNotice } from '@/modules/entryFees/Statements/notice';
import { renderCarbonePdf } from '@/modules/carbone/client';
import { uploadPdf } from '@/modules/supabase/storage';

type Ctx = { params: Promise<{ statementId: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const notice = await buildStatementNotice(req, statementId);
  if (!notice) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }

  const templateId = process.env.CARBONE_TEMPLATE_ID ?? '';
  const fileName = buildNoticeFileName(notice.notice, notice.distributor);
  const filePath = `notices/${fileName}`;

  const pdf = await renderCarbonePdf(templateId, notice);
  await uploadPdf(filePath, pdf);

  return withCors(
    new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
