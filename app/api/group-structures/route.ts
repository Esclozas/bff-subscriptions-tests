export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { decodeCursor, encodeCursor } from '@/modules/grouping/cursor';
import { listGroupStructures, createGroupStructure } from '@/modules/grouping/db';

const GetQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(200).default(50),
  cursor: z.string().optional(),
  is_active: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v))
    .refine((v) => v === undefined || ['true', 'false', '1', '0'].includes(v), 'Invalid is_active')
    .transform((v) => {
      if (v === undefined) return null;
      return v === 'true' || v === '1';
    }),
});


const MappingSchema = z.object({
  source_group_id: z.string().uuid(),
  billing_group_id: z.string().uuid(),
});

const PostBodySchema = z.object({
  label: z.string().min(1).max(200).optional(),
  activate: z.boolean().default(false),
  mappings: z.array(MappingSchema).default([]),
});



function validateUniqueSources(mappings: { source_group_id: string; billing_group_id: string }[]) {
  const seen = new Set<string>();
  for (const m of mappings) {
    if (seen.has(m.source_group_id)) return m.source_group_id;
    seen.add(m.source_group_id);
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = GetQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    is_active: url.searchParams.get('is_active') ?? undefined,
  });

  if (!parsed.success) {
    return withCors(
      NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
    );
  }

  const cursor = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : null;

  const { items, nextCursor, total } = await listGroupStructures({
    limit: parsed.data.limit,
    isActive: parsed.data.is_active,
    cursor,
  });

  return withCors(
    NextResponse.json({
      items,
      next_cursor: nextCursor ? encodeCursor(nextCursor) : null,
      limit: parsed.data.limit,
      total,
    }),
  );
} // ✅ fermeture de GET


export async function POST(req: NextRequest) {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = PostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return withCors(
      NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
    );
  }

  // mappings peuvent être vides si tu l’acceptes (fallback global = tout seul)
  // Si tu veux rendre mappings obligatoire, remplace par: if (!parsed.data.mappings.length) => 400
  const dup = validateUniqueSources(parsed.data.mappings);
  if (dup) {
    return withCors(
      NextResponse.json(
        { message: 'Bad Request', detail: 'Duplicate source_group_id in mappings', source_group_id: dup },
        { status: 400 },
      ),
    );
  }

  try {
  const created = await createGroupStructure({
    label: parsed.data.label ?? null,
    activate: parsed.data.activate,
    mappings: parsed.data.mappings,
  });

    return withCors(NextResponse.json(created, { status: 201 }));
  } catch (err: any) {
    const code = err?._pgcode ?? err?.code ?? null;

    // 23505 = unique_violation (ex: source dup / contrainte active unique)
    if (code === '23505') {
      return withCors(
        NextResponse.json(
          { message: 'Conflict', detail: 'DB constraint conflict (unique violation).', code },
          { status: 409 },
        ),
      );
    }

    return withCors(
      NextResponse.json(
        { message: 'DB failure on create group structure', detail: String(err?.message ?? err) },
        { status: 500 },
      ),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
