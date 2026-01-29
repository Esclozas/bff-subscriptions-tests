export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { z } from 'zod';
import { buildNoticeFileName, buildStatementNotice } from '@/modules/entryFees/Statements/notice';
import { renderCarbonePdf } from '@/modules/carbone/client';
import { createSignedUrl, getPublicUrl, shouldUsePublicUrl, uploadPdf } from '@/modules/supabase/storage';

type Ctx = { params: Promise<{ statementId: string }> };

const BodySchema = z.object({
  preview_expires_in: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest, context: Ctx) {
  const { statementId } = await context.params;

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
  const fileName = buildNoticeFileName(notice.notice, notice.distributor);
  const filePath = `notices/${fileName}`;

  const pdf = await renderCarbonePdf(templateId, notice);
  const uploaded = await uploadPdf(filePath, pdf);
  const usePublicUrl = shouldUsePublicUrl();
  let previewUrl: string | null = null;
  let expiresAt: string | null = null;

  if (usePublicUrl) {
    previewUrl = getPublicUrl(filePath);
  } else {
    const signed = await createSignedUrl(filePath, previewExpiresIn);
    previewUrl = signed.previewUrl;
    expiresAt = signed.expiresAt;
  }

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
