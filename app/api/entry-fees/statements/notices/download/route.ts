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
    const notice = await buildStatementNotice(req, statementId);
    if (!notice) {
      return withCors(NextResponse.json({ message: 'Not Found', statementId }, { status: 404 }));
    }

    const fileName = buildNoticeFileName(notice.notice, notice.distributor);
    const filePath = `notices/${fileName}`;

    const pdf = await renderCarbonePdf(templateId, notice);
    await uploadPdf(filePath, pdf);

    let previewUrl: string | null = null;
    let expiresAt: string | null = null;

    if (usePublicUrl) {
      previewUrl = getPublicUrl(filePath);
    } else {
      const signed = await createSignedUrl(filePath, previewExpiresIn);
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
