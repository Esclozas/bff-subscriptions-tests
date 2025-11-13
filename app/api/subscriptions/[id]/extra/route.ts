/**
 * Routes: 
 *   PUT    /api/subscriptions/:id/extra
 *   DELETE /api/subscriptions/:id/extra
 *
 * PUT:
 *   - Trouve operationId correspondant à la subscription (via overview).
 *   - Upsert dans Neon: closingName, entry_fees_percent, entry_fees_amount, comment, etc.
 *   - Accepte ancien nommage (retroPercent/retroAmount) et nouveau entry_fees_*.
 *   - Renvoie les valeurs enregistrées.
 *
 * DELETE:
 *   - Supprime les extras Neon pour cette subscription (clé operationId).
 *
 * Usage:
 *   PUT    → modifier les données personnalisées Neon pour une subscription
 *   DELETE → les retirer complètement
 *
 * Rien n’est modifié chez developv4 : uniquement la table Neon.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertExtraByOperationId, deleteExtraByOperationId } from '@/lib/db';

type Ctx = { params: Promise<{ id: string }> };

function cookieHeaderFrom(req: NextRequest) {
  const cookie = req.headers.get('cookie') ?? '';
  if (cookie) return cookie;
  const token = process.env.UPSTREAM_ACCESS_TOKEN;
  return token ? `accessToken=${token}` : '';
}

async function fetchOverviewPage(page: number, size: number, cookie: string) {
  const base = process.env.UPSTREAM_API_BASE_URL!;
  const url = `${base}/overview?page=${page}&size=${size}`;
  const payload = {
    status: [],
    partIds: [],
    personTypes: [],
    internal: false,
    timeZone: 'Europe/Paris',
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstream ${res.status} @ ${url} :: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<{ content?: any[]; items?: any[] }>;
}

async function resolveOperationIdBySubscriptionId(req: NextRequest, subscriptionId: string) {
  const cookie = cookieHeaderFrom(req);
  const PAGE_SIZE = 100;
  let page = 0;

  while (page < 10) {
    const data = await fetchOverviewPage(page, PAGE_SIZE, cookie);
    const list = (Array.isArray(data.content)
      ? data.content
      : Array.isArray(data.items)
      ? data.items
      : []) as any[];

    const found = list.find(
      (it) => (it?.id ?? it?.subscriptionId ?? it?.subscription?.id) === subscriptionId,
    );
    if (found) return found?.operationId ?? found?.operation?.id ?? null;
    if (list.length < PAGE_SIZE) break;
    page += 1;
  }
  return null;
}

// Body : on accepte à la fois l'ancien nommage retro* ET le nouveau entry_fees_*
const BodySchema = z.object({
  closingId: z.string().uuid().nullable().optional(),
  closingName: z.string().nullable().optional(),

  // nouveau nommage
  entry_fees_percent: z.number().min(0).nullable().optional(),
  entry_fees_amount: z.number().min(0).nullable().optional(),

  // compat ancien nommage (retro*)
  retroPercent: z.number().min(0).nullable().optional(),
  retroAmount: z.number().min(0).nullable().optional(),

  comment: z.string().nullable().optional(),
});

export async function PUT(req: NextRequest, context: Ctx) {
  try {
    const { id: subscriptionId } = await context.params;

    const operationId = await resolveOperationIdBySubscriptionId(req, subscriptionId);
    if (!operationId) {
      return NextResponse.json(
        { message: 'operationId not found for this subscription', subscriptionId },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Bad Request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const data = parsed.data;
    const entryFeesPercent =
      data.entry_fees_percent ?? (data.retroPercent != null ? data.retroPercent : null);
    const entryFeesAmount =
      data.entry_fees_amount ?? (data.retroAmount != null ? data.retroAmount : null);

    const saved = await upsertExtraByOperationId(operationId, {
      closingId: data.closingId ?? null,
      closingName: data.closingName ?? null,
      entryFeesPercent,
      entryFeesAmount,
      comment: data.comment ?? null,
    });

    return NextResponse.json(saved ?? {});
  } catch (err: any) {
    return NextResponse.json(
      { message: 'DB failure on upsert extra', detail: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, context: Ctx) {
  try {
    const { id: subscriptionId } = await context.params;

    const operationId = await resolveOperationIdBySubscriptionId(req, subscriptionId);
    if (!operationId) {
      return NextResponse.json(
        { message: 'operationId not found for this subscription', subscriptionId },
        { status: 400 },
      );
    }

    await deleteExtraByOperationId(operationId);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    return NextResponse.json(
      { message: 'DB failure on delete extra', detail: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
