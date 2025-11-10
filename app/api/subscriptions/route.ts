import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';

const ExtraSchema = z.object({
  closingId: z.string().uuid(),
  closingName: z.string().min(1),
  retroPercent: z.number().nullable().optional(),
  retroAmount: z.number().nullable().optional(),
  comment: z.string().nullable().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const parse = ExtraSchema.safeParse(body);
  if (!parse.success) return NextResponse.json({ error: parse.error.flatten() }, { status: 400 });

  const { closingId, closingName, retroPercent, retroAmount, comment } = parse.data;

const rows = await sql`
    INSERT INTO subscription_extra (subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment)
    VALUES (${id}, ${closingId}, ${closingName}, ${retroPercent ?? null}, ${retroAmount ?? null}, ${comment ?? null})
    ON CONFLICT (subscription_id) DO UPDATE SET
      closing_id = EXCLUDED.closing_id,
      closing_name = EXCLUDED.closing_name,
      retro_percent = EXCLUDED.retro_percent,
      retro_amount = EXCLUDED.retro_amount,
      comment = EXCLUDED.comment,
      updated_at = now()
    RETURNING subscription_id
  `;

  const subscriptionId = (rows as any)[0]?.subscription_id as string;
  return NextResponse.json({ subscriptionId });

}

export async function DELETE(_: NextRequest, context: Ctx) {
  const { id } = await context.params;
  await sql`DELETE FROM subscription_extra WHERE subscription_id = ${id}`;
  return new NextResponse(null, { status: 204 });
}
