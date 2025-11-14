// lib/cors.ts
import { NextResponse, NextRequest } from 'next/server';

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN || 'http://localhost:3002'; // ou '*' si tu veux tout ouvrir

export function withCors(res: NextResponse) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return res;
}

// Optionnel : pour les préflight OPTIONS
export function handleOptions(req: NextRequest) {
  const res = new NextResponse(null, { status: 204 });
  return withCors(res);
}
