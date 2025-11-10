export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertExtra, deleteExtra } from '@/lib/db';

const BodySchema = z.object({
  closingId: z.string().uuid().nullable().optional(),
  closingName: z.string().nullable().optional(),
  retroPercent: z.number().min(0).max(1).nullable().optional(),
  retroAmount: z.number().min(0).nullable().optional(),
  comment: z.string().nullable().optional()
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, context: Ctx) {
  try {
    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 });
    }
    const saved = await upsertExtra(id, parsed.data);
    return NextResponse.json(saved ?? {});
  } catch (err: any) {
    console.error('PUT /api/subscriptions/[id]/extra failed', { reason: String(err?.message ?? err) });
    return NextResponse.json(
      { message: 'DB failure on upsert extra', detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, context: Ctx) {
  try {
    const { id } = await context.params;
    await deleteExtra(id);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error('DELETE /api/subscriptions/[id]/extra failed', { reason: String(err?.message ?? err) });
    return NextResponse.json(
      { message: 'DB failure on delete extra', detail: String(err?.message ?? err) },
      { status: 500 }
    );
  }
}
