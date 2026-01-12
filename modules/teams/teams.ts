// modules/teams/teams.ts
import { upstreamTeams } from '@/lib/http-teams';

type TeamsPage = {
  content?: any[];
  items?: any[];
  totalPages?: number;
  totalElements?: number;
  number?: number; // current page
  size?: number;   // page size
};

const PAGE_SIZE = 2000; // comme subscriptions, tu peux monter/descendre

export async function loadAllTeams(cookie: string): Promise<any[]> {
  let page = 0;
  let full: any[] = [];
  let maxPages = 50; // sécurité

  while (page < maxPages) {
    const params = new URLSearchParams({
      page: String(page),
      size: String(PAGE_SIZE),
    });

    const data = (await upstreamTeams(`/teams?${params.toString()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(process.env.UPSTREAM_ACCESS_TOKEN ? { 'X-jwt': process.env.UPSTREAM_ACCESS_TOKEN } : {}),
      },
    })) as TeamsPage;

    const list =
      Array.isArray(data.content) ? data.content :
      Array.isArray(data.items) ? data.items :
      [];

    full = full.concat(list);

    // stop conditions
    if (typeof data.totalPages === 'number') {
      maxPages = data.totalPages;
    } else {
      // fallback si totalPages n’existe pas
      if (list.length < PAGE_SIZE) break;
    }

    if (list.length < PAGE_SIZE) break;
    page++;
  }

  return full;
}
