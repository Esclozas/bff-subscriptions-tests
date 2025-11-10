import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { ExtraRow, flattenItem } from '@/lib/subscriptions';

function authHeaders() {
  const h: Record<string,string> = {};
  if (process.env.SOURCE_API_TOKEN) h.Authorization = `Bearer ${process.env.SOURCE_API_TOKEN}`;
  return h;
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, context: Ctx) {
  const { id } = await context.params;

  // 1) Détail source
  const base = process.env.SOURCE_API_URL!;
  const url = base.endsWith('/') ? base + id : `${base}/${id}`;
  const r = await fetch(url, { headers: authHeaders(), cache: 'no-store' });
  if (r.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!r.ok) return NextResponse.json({ error: `Source API error ${r.status}` }, { status: 502 });
  const src = await r.json();

  // 2) Extra Neon
  const rows = await sql`
    SELECT subscription_id, closing_id, closing_name, retro_percent, retro_amount, comment
    FROM subscription_extra WHERE subscription_id = ${id} LIMIT 1
  `;
  const extra = (rows as any)[0] as ExtraRow | undefined;

  // 3) Fusion
  return NextResponse.json(flattenItem(src, extra));
}
