import { NextResponse } from 'next/server';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: true, endpoint: `GET /api/subscriptions/${params.id}` });
}
