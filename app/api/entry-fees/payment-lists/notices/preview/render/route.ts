export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { buildNoticeFileName } from '@/modules/entryFees/Statements/notice';
import { buildDraftNotices } from '@/modules/entryFees/payment-lists/notice_preview';
import { renderCarbonePdf } from '@/modules/carbone/client';
import {
  createSignedUrl,
  getPublicUrl,
  shouldUsePublicUrl,
  uploadPdf,
} from '@/modules/supabase/storage';

const SnapshotSchema = z.object({
  subscriptionId: z.string().uuid(),
  operationId: z.string().nullable().optional(),
  teamId: z.string().uuid().nullable(),
  teamName: z.string().nullable().optional(),
  amountCurrency: z.string().nullable(),
  entry_fees_amount: z.coerce.number().nullable(),
  fundId: z.string().uuid().nullable().optional(),
  fundName: z.string().nullable().optional(),
  partId: z.string().uuid().nullable().optional(),
  partName: z.string().nullable().optional(),
  investorName: z.string().nullable().optional(),
  validationDate: z.string().nullable().optional(),
});

const BodySchema = z.object({
  subscription_snapshots: z.array(SnapshotSchema).min(1).max(500),
  group_structure_id: z.string().uuid().optional(),
  payment_list_id: z.string().uuid().optional(),
  skip_team_lookup: z.boolean().optional(),
  issue_date: z.string().optional(),
  preview_expires_in: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const previewExpiresIn =
      parsed.data.preview_expires_in ??
      Number(process.env.SUPABASE_SIGNED_URL_EXPIRES ?? 3600);

    const { notices, groupStructureId, paymentListId } = await buildDraftNotices(req, {
      subscriptionSnapshots: parsed.data.subscription_snapshots,
      groupStructureId: parsed.data.group_structure_id ?? null,
      paymentListId: parsed.data.payment_list_id ?? null,
      skipTeamLookup: parsed.data.skip_team_lookup ?? false,
      issueDate: parsed.data.issue_date ?? null,
    });

    const previewBucket = process.env.SUPABASE_PREVIEW_BUCKET;
    const usePublicUrl = shouldUsePublicUrl(previewBucket);
    const templateId = process.env.CARBONE_TEMPLATE_ID ?? '';

    const results: Array<{
      notice: (typeof notices)[number];
      file: {
        bucket: string;
        path: string;
        file_name: string;
        preview_url: string | null;
        expires_at: string | null;
        public: boolean;
      };
    }> = [];

    for (const notice of notices) {
      const fileName = buildNoticeFileName(notice.notice, notice.distributor);
      const filePath = `previews/${fileName}`;

      const pdf = await renderCarbonePdf(templateId, notice);
      const uploaded = await uploadPdf(filePath, pdf, previewBucket);

      let previewUrl: string | null = null;
      let expiresAt: string | null = null;

      if (usePublicUrl) {
        previewUrl = getPublicUrl(filePath, previewBucket);
      } else {
        const signed = await createSignedUrl(filePath, previewExpiresIn, previewBucket);
        previewUrl = signed.previewUrl;
        expiresAt = signed.expiresAt;
      }

      results.push({
        notice,
        file: {
          bucket: uploaded.bucket,
          path: uploaded.path,
          file_name: fileName,
          preview_url: previewUrl,
          expires_at: expiresAt,
          public: usePublicUrl,
        },
      });
    }

    return withCors(
      NextResponse.json({
        group_structure_id: groupStructureId,
        payment_list_id: paymentListId,
        notices: results,
        public: usePublicUrl,
      }),
    );
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const details = err?.details ?? null;

    if (msg.startsWith('BAD_REQUEST_')) {
      return withCors(
        NextResponse.json(
          { message: msg, ...(details ?? {}) },
          { status: 400 },
        ),
      );
    }

    console.error('POST /api/entry-fees/payment-lists/notices/preview/render failed', { reason: msg });

    return withCors(
      NextResponse.json(
        { message: 'Internal Server Error', detail: msg },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
