export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/cors';
import { computeAnnouncedTotalsFromBff, computeAnnouncedTotalsFromSnapshots } from '@/modules/entryFees/payment-lists/totals';
import { withTx, createPaymentListAtomicTx, listPaymentLists } from '@/modules/entryFees/payment-lists/db';
import { generateStatementsAtomicTx, generateStatementsFromSnapshotsAtomicTx } from '@/modules/entryFees/payment-lists/statements';



function cookieHeaderFrom(req: NextRequest) {
  const incoming = req.headers.get('cookie') ?? '';
  if (incoming) return incoming;
  if (process.env.UPSTREAM_ACCESS_TOKEN) return `accessToken=${process.env.UPSTREAM_ACCESS_TOKEN}`;
  return '';
}

const SnapshotSchema = z.object({
  subscriptionId: z.string().uuid(),
  teamId: z.string().uuid().nullable(),
  teamName: z.string().nullable().optional(),
  amountCurrency: z.string().nullable(),
  entry_fees_amount: z.coerce.number().nullable(),
  entry_fees_amount_total: z.coerce.number().nullable().optional(),
  entry_fees_assigned_amount_total: z.coerce.number().nullable().optional(),
});

const CreateBodySchema = z.object({
  payment_list_id: z.string().uuid().optional(),
  created_by: z.string().min(1),
  group_structure_id: z.string().uuid(),
  period_label: z.string().nullable().optional(),

  subscriptions: z.array(z.string().uuid()).min(1).optional(),
  subscription_snapshots: z.array(SnapshotSchema).min(1).optional(),

  // style A
  totals: z
    .array(
      z.object({
        currency: z.string().min(1),
        announced_total: z.string().min(1), // decimal string
        subscriptions_count: z.number().int().nonnegative().optional(),
        statements_count: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),

  // style B
  compute_totals: z.boolean().optional(),

  // Optionnel: renvoyer les statements créés dans la réponse
  include_statements: z.boolean().optional(),
}).superRefine((data, ctx) => {
  if (!data.subscription_snapshots?.length && !data.subscriptions?.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either subscription_snapshots[] or subscriptions[] is required',
      path: ['subscription_snapshots'],
    });
  }
  if (data.subscription_snapshots?.length && data.subscriptions?.length) {
    const snapIds = new Set(data.subscription_snapshots.map((s) => s.subscriptionId));
    const subIds = new Set(data.subscriptions);
    if (snapIds.size !== subIds.size) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'subscription_snapshots and subscriptions must match',
        path: ['subscription_snapshots'],
      });
    }
    for (const id of snapIds) {
      if (!subIds.has(id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'subscription_snapshots and subscriptions must match',
          path: ['subscription_snapshots'],
        });
        break;
      }
    }
  }
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const created_by = url.searchParams.get('created_by');
  const group_structure_id = url.searchParams.get('group_structure_id');

  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const cursor = url.searchParams.get('cursor');

  const data = await listPaymentLists({
    from,
    to,
    created_by,
    group_structure_id,
    limit: Number.isFinite(limit) ? limit : 50,
    cursor,
  });

  return withCors(NextResponse.json(data));
}

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = CreateBodySchema.safeParse(raw);

    if (!parsed.success) {
      return withCors(
        NextResponse.json({ message: 'Bad Request', issues: parsed.error.issues }, { status: 400 }),
      );
    }

    const body = parsed.data;
    const snapshots = body.subscription_snapshots ?? null;
    const subscriptionIds = snapshots?.length
      ? snapshots.map((s) => s.subscriptionId)
      : body.subscriptions;

    // 1) Déterminer les totals annoncés
    let totalsToInsert: Array<{ currency: string; total_announced: string }> = [];

    if (body.compute_totals) {
      if (snapshots?.length) {
        totalsToInsert = computeAnnouncedTotalsFromSnapshots(snapshots);
      } else {
        const origin = req.nextUrl.origin;
        const cookie = cookieHeaderFrom(req);
        totalsToInsert = await computeAnnouncedTotalsFromBff({
          origin,
          subscriptionIds,
          cookieHeader: cookie,
        });
      }

      if (!totalsToInsert.length) {
        return withCors(
          NextResponse.json(
            { message: 'Unable to compute totals (no matching subscriptions found)' },
            { status: 400 },
          ),
        );
      }
    } else {
      if (!body.totals?.length) {
        return withCors(
          NextResponse.json(
            { message: 'Either totals[] or compute_totals=true is required' },
            { status: 400 },
          ),
        );
      }

      totalsToInsert = body.totals.map((t) => ({
        currency: t.currency,
        total_announced: t.announced_total,
      }));
    }


    const created = await withTx(async (client) => {

      // 0) HARD RULE: une subscription ne peut être utilisée que si elle n'est pas déjà dans un statement NON annulé
      const conflict = await client.query(
        `
        SELECT
          ss.subscription_id,
          s.entry_fees_payment_list_id,
          s.id AS statement_id,
          s.issue_status
        FROM public.entry_fees_statement_subscription ss
        JOIN public.entry_fees_statement s
          ON s.id = ss.entry_fees_statement_id
        WHERE ss.subscription_id = ANY($1::uuid[])
          AND s.issue_status <> 'CANCELLED'
        LIMIT 20
        `,
        [subscriptionIds],
      );

      if (conflict.rows.length > 0) {
        throw new Error(`CONFLICT_SUB_ALREADY_ASSIGNED ${JSON.stringify(conflict.rows)}`);
      }

    // 1) crée le payment list + subs + totals (dans la transaction)
    const pl = await createPaymentListAtomicTx(client, {
        id: body.payment_list_id,
        created_by: body.created_by,
        group_structure_id: body.group_structure_id,
        period_label: body.period_label ?? null,
        subscriptions: subscriptionIds,
        totals: totalsToInsert.map((t) => ({
        currency: t.currency,
        total_announced: t.total_announced,
        subscriptions_count: subscriptionIds.length,
        statements_count: 0,
        })),
    });

    if (!pl?.id) throw new Error('DB_FAILURE_PAYMENT_LIST_NOT_CREATED');

    // 2) génère les statements (dans la MÊME transaction)
    const statementsRes = snapshots?.length
      ? await generateStatementsFromSnapshotsAtomicTx(client, {
          paymentListId: pl.id,
          groupStructureId: pl.group_structure_id,
          snapshots,
        })
      : await generateStatementsAtomicTx(client, {
          origin: req.nextUrl.origin,
          paymentListId: pl.id,
          groupStructureId: pl.group_structure_id,
          subscriptionIds,
        });

    return {
      ...pl,
      ...(body.include_statements ? { statements: statementsRes.items ?? [] } : {}),
    };
    });

    return withCors(NextResponse.json(created, { status: 201 }));


  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const code = String(err?.code ?? err?._pgcode ?? '').toUpperCase();

    if (msg.startsWith('CONFLICT_SUB_ALREADY_ASSIGNED')) {
      return withCors(
        NextResponse.json(
          {
            message: 'Subscriptions already assigned to a non-cancelled statement',
            detail: msg,
          },
          { status: 409 },
        ),
      );
    }

    if (code === '23505') {
      return withCors(
        NextResponse.json(
          { message: 'Payment list id already exists', detail: msg },
          { status: 409 },
        ),
      );
    }


    // ✅ Optionnel mais recommandé: mapper les erreurs "BAD_REQUEST_..." en 400
    if (msg.startsWith('BAD_REQUEST_')) {
      return withCors(NextResponse.json({ message: msg }, { status: 400 }));
    }

    console.error('POST /api/payment-lists failed', { reason: msg });

    return withCors(
      NextResponse.json({ message: 'DB failure on create payment list', detail: msg }, { status: 500 }),
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
