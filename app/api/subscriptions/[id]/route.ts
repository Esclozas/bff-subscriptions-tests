export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtras } from '@/lib/db';
import { flatten } from '@/lib/flatten';

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params; // 👈 important avec Next 16
  const item = await upstream(`/subscriptions/${id}`);
  const extras = await selectExtras([id]);
  const flat = flatten(item, extras.get(id));
  if (!flat.subscriptionId) {
    return NextResponse.json({ message: 'Not Found' }, { status: 404 });
  }
  return NextResponse.json(flat);
}
