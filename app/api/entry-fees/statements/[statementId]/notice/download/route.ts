export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { buildNoticeFileName, buildStatementNotice } from '@/modules/entryFees/Statements/notice';
import { renderCarbonePdf } from '@/modules/carbone/client';
import {
  uploadPdf,
  createSignedUrl,
  getPublicUrl,
  shouldUsePublicUrl,
} from '@/modules/supabase/storage';
import { getStatement, markStatementNoticeGenerated } from '@/modules/entryFees/Statements/db';

type Ctx = { params: Promise<{ statementId: string }> };

export async function GET(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const statement = await getStatement(statementId);
  if (!statement) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }

  const notice = await buildStatementNotice(req, statementId);
  if (!notice) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }

  const templateId = process.env.CARBONE_TEMPLATE_ID ?? '';
  const computedFileName = buildNoticeFileName(notice.notice, notice.distributor);
  const canonicalFilePath = `notices/${statementId}.pdf`;
  const usePublicUrl = shouldUsePublicUrl();
  const bucket = statement.notice_pdf_bucket ?? process.env.SUPABASE_BUCKET ?? null;

  if (statement.notice_pdf_generated_at) {
    const fileName = statement.notice_pdf_file_name ?? computedFileName;
    const filePath = statement.notice_pdf_path ?? `notices/${fileName}`;
    let fileUrl: string | null = null;
    if (usePublicUrl) {
      fileUrl = getPublicUrl(filePath, bucket ?? undefined);
    } else {
      const signed = await createSignedUrl(
        filePath,
        Number(process.env.SUPABASE_SIGNED_URL_EXPIRES ?? 3600),
        bucket ?? undefined,
      );
      fileUrl = signed.previewUrl;
    }

    const fileRes = await fetch(fileUrl, { cache: 'no-store' });
    if (!fileRes.ok) {
      return withCors(
        NextResponse.json(
          { message: 'Notice PDF not found in storage', statementId },
          { status: 404 },
        ),
      );
    }
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return withCors(
      new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Cache-Control': 'no-store',
        },
      }),
    );
  }

  const pdf = await renderCarbonePdf(templateId, notice);
  const fileName = computedFileName;
  const filePath = canonicalFilePath;
  const uploaded = await uploadPdf(filePath, pdf, bucket ?? undefined);
  await markStatementNoticeGenerated({
    statementId,
    path: uploaded.path ?? filePath,
    fileName,
    bucket: uploaded.bucket ?? bucket ?? null,
  });

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
