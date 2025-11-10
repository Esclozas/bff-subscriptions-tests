export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertExtra, deleteExtra } from '@/lib/db';

const BodySchema = z.object({
  closingId: z.string().uuid().nullable().optional(),
  closingName: z.string().nullable().optional(),
  retroPercent: z.number().min(0).max(1).nullable().optional(),
  retroAmount: z.number().min(0).nullable().optional(),
  comment: z.string().nullable().optional()
});

type Params = { params: { id: string } };

export async function PUT(req: Request, { params }: Params) {
  const id = params.id;
  const body = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 });
  }
  const saved = await upsertExtra(id, parsed.data);
  return NextResponse.json(saved ?? {});
}

export async function DELETE(_req: Request, { params }: Params) {
  await deleteExtra(params.id);
  return new NextResponse(null, { status: 204 });
}
