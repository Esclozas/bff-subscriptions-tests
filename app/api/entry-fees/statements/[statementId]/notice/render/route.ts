export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { z } from 'zod';
import { buildNoticeFileName, buildStatementNotice } from '@/modules/entryFees/Statements/notice';
import { renderCarbonePdf } from '@/modules/carbone/client';
import { createSignedUrl, getPublicUrl, shouldUsePublicUrl, uploadPdf } from '@/modules/supabase/storage';
import { getStatement, markStatementNoticeGenerated } from '@/modules/entryFees/Statements/db';

type Ctx = { params: Promise<{ statementId: string }> };

const BodySchema = z.object({
  preview_expires_in: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

  const statement = await getStatement(statementId);
  if (!statement) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }

  const notice = await buildStatementNotice(req, statementId);
  if (!notice) {
    return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return withCors(NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }));
  }

  const previewExpiresIn =
    parsed.data.preview_expires_in ??
    Number(process.env.SUPABASE_SIGNED_URL_EXPIRES ?? 3600);

  const templateId = process.env.CARBONE_TEMPLATE_ID ?? '';
  const computedFileName = buildNoticeFileName(notice.notice, notice.distributor);
  const canonicalFilePath = `notices/${statementId}.pdf`;
  const usePublicUrl = shouldUsePublicUrl();
  const bucket = statement.notice_pdf_bucket ?? process.env.SUPABASE_BUCKET ?? null;

  if (statement.notice_pdf_generated_at) {
    const fileName = statement.notice_pdf_file_name ?? computedFileName;
    const filePath = statement.notice_pdf_path ?? `notices/${fileName}`;
    let previewUrl: string | null = null;
    let expiresAt: string | null = null;

    if (usePublicUrl) {
      previewUrl = getPublicUrl(filePath, bucket ?? undefined);
    } else {
      const signed = await createSignedUrl(filePath, previewExpiresIn, bucket ?? undefined);
      previewUrl = signed.previewUrl;
      expiresAt = signed.expiresAt;
    }

    return withCors(
      NextResponse.json({
        notice,
        already_generated: true,
        file: {
          bucket,
          path: filePath,
          file_name: fileName,
          preview_url: previewUrl,
          expires_at: expiresAt,
          public: usePublicUrl,
        },
      }),
    );
  }

  const pdf = await renderCarbonePdf(templateId, notice);
  const fileName = computedFileName;
  const filePath = canonicalFilePath;
  const uploaded = await uploadPdf(filePath, pdf, bucket ?? undefined);
  let previewUrl: string | null = null;
  let expiresAt: string | null = null;

  if (usePublicUrl) {
    previewUrl = getPublicUrl(filePath, bucket ?? undefined);
  } else {
    const signed = await createSignedUrl(filePath, previewExpiresIn, bucket ?? undefined);
    previewUrl = signed.previewUrl;
    expiresAt = signed.expiresAt;
  }

  await markStatementNoticeGenerated({
    statementId,
    path: uploaded.path ?? filePath,
    fileName,
    bucket: uploaded.bucket ?? bucket ?? null,
  });

  return withCors(
    NextResponse.json({
      notice,
      file: {
        bucket: uploaded.bucket,
        path: uploaded.path,
        file_name: fileName,
        preview_url: previewUrl,
        expires_at: expiresAt,
        public: usePublicUrl,
      },
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
