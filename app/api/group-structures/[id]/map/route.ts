export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/cors';
import { getGroupStructure, getGroupStructureMap } from '@/modules/grouping/db';
import { fetchAllTeamsFromReq, indexTeamsById } from '@/modules/teams/client';

type Ctx = { params: any };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = (await ctx.params) as { id: string };

  const version = await getGroupStructure(id);
  if (!version) {
    return withCors(NextResponse.json({ message: 'Not Found', id }, { status: 404 }));
  }

  // Mapping DB (ids only)
  const mappings = await getGroupStructureMap(id);

  // 🔹 Chargement des teams via le même BFF
  let teamsById = new Map<string, { id: string; name: string | null }>();
  try {
    const teams = await fetchAllTeamsFromReq(req);
    teamsById = indexTeamsById(teams);
  } catch {
    // Fail-soft: on continue sans les noms
    teamsById = new Map();
  }

  // 🔹 Enrichissement
  const enriched = mappings.map((m) => {
    const source = teamsById.get(m.source_group_id) ?? null;
    const billing = teamsById.get(m.billing_group_id) ?? null;

    return {
      source_group_id: m.source_group_id,
      billing_group_id: m.billing_group_id,

      // champs simples (pratiques côté front)
      source_group_name: source?.name ?? null,
      billing_group_name: billing?.name ?? null,

      // objets complets (optionnels mais propres)
      source_group: {
        id: m.source_group_id,
        name: source?.name ?? null,
      },
      billing_group: {
        id: m.billing_group_id,
        name: billing?.name ?? null,
      },
    };
  });

  return withCors(
    NextResponse.json({
      group_structure_id: id,
      mappings: enriched,
    }),
  );
}

export function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}
