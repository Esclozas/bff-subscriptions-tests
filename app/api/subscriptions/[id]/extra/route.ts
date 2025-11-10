import { NextResponse } from 'next/server';

export async function PUT(_: Request, { params }: { params: { id: string } }) {
  return NextResponse.json({ ok: true, endpoint: `PUT /api/subscriptions/${params.id}/extra` });
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  return new NextResponse(null, { status: 204 });
}
