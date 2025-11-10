import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { ExtraRow, flattenItem, searchable } from '@/lib/subscriptions';

const QuerySchema = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  teamId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  sort: z.enum(['createdDate','status','productName','teamName']).default('createdDate'),
  order: z.enum(['asc','desc']).default('desc'),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

function authHeaders() {
  const h: Record<string,string> = {};
  if (process.env.SOURCE_API_TOKEN) h.Authorization = `Bearer ${process.env.SOURCE_API_TOKEN}`;
  return h;
}

export async function GET(req: NextRequest) {
  const parse = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parse.success) return NextResponse.json({ error: parse.error.flatten() }, { status: 400 });
  const q = parse.data;

  const listUrl = new URL(process.env.SOURCE_API_URL!);
  for (const [k, v] of Object.entries({
    status: q.status, teamId: q.teamId, ownerId: q.ownerId, productId: q.productId,
    from: q.from, to: q.to, sort: q.sort, order: q.order, limit: q.limit, offset: q.offset,
  })) if (v != null) listUrl.searchParams.set(k, String(v));

  const r = await fetch(listUrl.toString(), { headers: authHeaders(), cache: 'no-store' });
  if (!r.ok) return NextResponse.json({ error: `Source API error ${r.status}` }, { status: 502 });
  const upstream = await r.json();
  const srcItems: any[] = upstream.items ?? upstream.data ?? [];

  const ids = srcItems.map(x => x.id).filter(Boolean);
  let extras = new Map<string, ExtraRow>();
  if (ids.length) {
    const rows = await sql<ExtraRow[]>`
      SELECT subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment
      FROM subscription_extra WHERE subscription_id = ANY(${ids})
    `;
    extras = new Map(rows.map(r => [r.subscription_id, r]));
  }

  let items = srcItems.map(src => flattenItem(src, extras.get(src.id)));
  if (q.q) {
    const needle = q.q.toLowerCase();
    items = items.filter(it => searchable(it).includes(needle));
  }

  return NextResponse.json({
    items,
    total: q.q ? items.length : (upstream.total ?? items.length),
    limit: q.limit,
    offset: q.offset,
  });
}
