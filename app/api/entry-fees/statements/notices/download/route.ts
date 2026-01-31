export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { z } from 'zod';
import { buildNoticeFileName, buildStatementNotice } from '@/modules/entryFees/Statements/notice';
import { renderCarbonePdf } from '@/modules/carbone/client';
import {
  createSignedUrl,
  getPublicUrl,
  shouldUsePublicUrl,
  uploadPdf,
} from '@/modules/supabase/storage';
import { getStatement, markStatementNoticeGenerated } from '@/modules/entryFees/Statements/db';

const BodySchema = z.object({
  statement_ids: z.array(z.string().uuid()).min(1).max(25),
  preview_expires_in: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }));
  }

  const previewExpiresIn =
    parsed.data.preview_expires_in ??
    Number(process.env.SUPABASE_SIGNED_URL_EXPIRES ?? 3600);

  const usePublicUrl = shouldUsePublicUrl();
  const templateId = process.env.CARBONE_TEMPLATE_ID ?? '';

  const files: Array<{
    statement_id: string;
    file_name: string;
    path: string;
    preview_url: string | null;
    expires_at: string | null;
  }> = [];

  for (const statementId of parsed.data.statement_ids) {
    const statement = await getStatement(statementId);
    if (!statement) {
      return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
    }

    const notice = await buildStatementNotice(req, statementId);
    if (!notice) {
      return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
    }

    const computedFileName = buildNoticeFileName(notice.notice, notice.distributor);
    const canonicalFilePath = `notices/${statementId}.pdf`;
    const bucket = statement.notice_pdf_bucket ?? process.env.SUPABASE_BUCKET ?? null;
    const fileName = statement.notice_pdf_file_name ?? computedFileName;
    const legacyFilePath = `notices/${fileName}`;
    const filePath =
      statement.notice_pdf_path ?? (statement.notice_pdf_generated_at ? legacyFilePath : canonicalFilePath);

    if (!statement.notice_pdf_generated_at) {
      const pdf = await renderCarbonePdf(templateId, notice);
      const uploaded = await uploadPdf(filePath, pdf, bucket ?? undefined);
      await markStatementNoticeGenerated({
        statementId,
        path: uploaded.path ?? filePath,
        fileName,
        bucket: uploaded.bucket ?? bucket ?? null,
      });
    }

    let previewUrl: string | null = null;
    let expiresAt: string | null = null;

    if (usePublicUrl) {
      previewUrl = getPublicUrl(filePath, bucket ?? undefined);
    } else {
      const signed = await createSignedUrl(filePath, previewExpiresIn, bucket ?? undefined);
      previewUrl = signed.previewUrl;
      expiresAt = signed.expiresAt;
    }

    files.push({
      statement_id: statementId,
      file_name: fileName,
      path: filePath,
      preview_url: previewUrl,
      expires_at: expiresAt,
    });
  }

  return withCors(
    NextResponse.json({
      files,
      public: usePublicUrl,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
