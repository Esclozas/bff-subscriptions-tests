export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { upstream } from '@/lib/http';
import { selectExtras } from '@/lib/db';
import { flatten } from '@/lib/flatten';

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  const id = params.id;
  const item = await upstream(`/subscriptions/${id}`);
  const extras = await selectExtras([id]);
  const flat = flatten(item, extras.get(id));
  if (!flat.subscriptionId) {
    return NextResponse.json({ message: 'Not Found' }, { status: 404 });
  }
  return NextResponse.json(flat);
}
