// app/api/subscriptions/[id]/extra/route.ts
/**
 * Routes: 
 *   PUT    /api/subscriptions/:id/extra
 *   DELETE /api/subscriptions/:id/extra
 *
 * PUT:
 *   - Récupère operationId via le détail BFF /api/subscriptions/:id (qui utilise déjà developv4).
 *   - Upsert dans Neon: closingName, entry_fees_percent, entry_fees_amount, totals, overridden, comment, etc.
 *   - Accepte l’ancien nommage (retroPercent/retroAmount/comment) et le nouveau entry_fees_*.
 *   - Renvoie les valeurs enregistrées (format camelCase pour l’UI).
 *
 * DELETE:
 *   - Supprime les extras Neon pour cette subscription (clé operationId).
 *
 * Usage:
 *   PUT    → modifier les données personnalisées Neon pour une subscription
 *   DELETE → les retirer complètement
 *
 * Rien n’est modifié chez developv4 : uniquement la table Neon (subscription_extra).
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { upsertExtraByOperationId, deleteExtraByOperationId } from '@/lib/db';

// Contrat d’entrée accepté par le BFF pour le PUT
const BodySchema = z.object({
  // Closing
  closingId: z.string().uuid().nullable().optional(),
  closingName: z.string().nullable().optional(),

  // Nouveau nommage aligné Neon (snake_case)
  entry_fees_percent: z.number().nullable().optional(),
  entry_fees_amount: z.number().nullable().optional(),
  entry_fees_amount_total: z.number().nullable().optional(),
  entry_fees_assigned_amount_total: z.number().nullable().optional(),
  entry_fees_assigned_overridden: z.boolean().nullable().optional(),
  entry_fees_assigned_manual_by: z.string().nullable().optional(),
  entry_fees_assigned_comment: z.string().nullable().optional(),

  // Ancien nommage (retro*)
  retroPercent: z.number().nullable().optional(),
  retroAmount: z.number().nullable().optional(),
  comment: z.string().nullable().optional(),
});

// En Next 16, params est un Promise
type Ctx = { params: Promise<{ id: string }> };

/** Récupère operationId en appelant la route BFF détail /api/subscriptions/:id */
async function resolveOperationIdFromBff(req: NextRequest, subscriptionId: string): Promise<string | null> {
  try {
    const origin = req.nextUrl.origin; // ex: http://localhost:3000 ou https://bff-subscriptions-tests.vercel.app

    const res = await fetch(`${origin}/api/subscriptions/${subscriptionId}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`BFF detail returned ${res.status}`);
    }

    const data = await res.json();
    const opId = data?.operationId ?? null;

    if (!opId) {
      console.error('resolveOperationIdFromBff: operationId missing in BFF detail', {
        subscriptionId,
      });
    }

    return opId;
  } catch (e) {
    console.error('resolveOperationIdFromBff failed', {
      subscriptionId,
      reason: String((e as any)?.message ?? e),
    });
    return null;
  }
}

export async function PUT(req: NextRequest, context: Ctx) {
  try {
    const { id: subscriptionId } = await context.params;

    // 1) Résoudre operationId via le détail BFF
    const operationId = await resolveOperationIdFromBff(req, subscriptionId);
    if (!operationId) {
      return NextResponse.json(
        { message: 'operationId not found for this subscription' },
        { status: 400 },
      );
    }

    // 2) Valider le body
    const rawBody = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { message: 'Bad Request', issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const body = parsed.data;

    // 3) Normaliser vers le contrat attendu par lib/db.ts (camelCase)
    const payload = {
      closingId: body.closingId ?? null,
      closingName: body.closingName ?? null,

      entryFeesPercent:
        body.entry_fees_percent ??
        (body.retroPercent != null ? body.retroPercent : null),

      entryFeesAmount:
        body.entry_fees_amount ??
        (body.retroAmount != null ? body.retroAmount : null),

      entryFeesAmountTotal: body.entry_fees_amount_total ?? null,
      entryFeesAssignedAmountTotal: body.entry_fees_assigned_amount_total ?? null,
      entryFeesAssignedOverridden: body.entry_fees_assigned_overridden ?? null,

      entryFeesAssignedManualBy: body.entry_fees_assigned_manual_by ?? null,
      entryFeesAssignedComment:
        body.entry_fees_assigned_comment ??
        (body.comment != null ? body.comment : null),
    };

    // 4) Upsert côté Neon
    const saved = await upsertExtraByOperationId(operationId, payload);
    return NextResponse.json(saved ?? {});
  } catch (err: any) {
    console.error('PUT /api/subscriptions/[id]/extra failed', {
      reason: String(err?.message ?? err),
    });
    return NextResponse.json(
      { message: 'DB failure on upsert extra', detail: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, context: Ctx) {
  try {
    const { id: subscriptionId } = await context.params;

    const operationId = await resolveOperationIdFromBff(req, subscriptionId);
    if (!operationId) {
      return NextResponse.json(
        { message: 'operationId not found for this subscription' },
        { status: 400 },
      );
    }

    await deleteExtraByOperationId(operationId);
    return new NextResponse(null, { status: 204 });
  } catch (err: any) {
    console.error('DELETE /api/subscriptions/[id]/extra failed', {
      reason: String(err?.message ?? err),
    });
    return NextResponse.json(
      { message: 'DB failure on delete extra', detail: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
