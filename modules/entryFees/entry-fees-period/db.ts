// modules/entry-fees/db.ts
import { neon } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

const TABLE = 'entry_fees_period';

export type EntryFeesPeriod = {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD (exclusif)
  created_by?: string | null; // si tu ajoutes la colonne plus tard
};

type PeriodRow = {
  id: string;
  start_date: string;
  end_date: string;
};

type PeriodRowWithTotal = PeriodRow & {
  total_count: number;
};


export async function listPeriods(args: {
  from?: string | null;
  to?: string | null;
  limit: number;
  cursor?: string | null; // base64("YYYY-MM-DD|uuid")
}) {
  const sql = getSql();

  const from = args.from ?? null;
  const to = args.to ?? null;
  const limit = Math.min(Math.max(args.limit ?? 200, 1), 500);

  // Cursor: (start_date, id) strictement > (cursorStart, cursorId)
  let cursorStart: string | null = null;
  let cursorId: string | null = null;
  if (args.cursor) {
    try {
      const decoded = Buffer.from(args.cursor, 'base64').toString('utf8');
      const [d, id] = decoded.split('|');
      cursorStart = d || null;
      cursorId = id || null;
    } catch {
      cursorStart = null;
      cursorId = null;
    }
  }

  // Intersection intervalle demandé:
  // period intersects [from,to)  <=> start_date < to AND end_date > from
  const rows = (await sql`
    SELECT
        id,
        start_date::text,
        end_date::text,
        COUNT(*) OVER() AS total_count
    FROM ${sql.unsafe(TABLE)}
    WHERE
      (${from}::date IS NULL OR end_date > ${from}::date)
      AND (${to}::date IS NULL OR start_date < ${to}::date)
      AND (
        ${cursorStart}::date IS NULL
        OR (start_date, id) > (${cursorStart}::date, ${cursorId}::uuid)
      )
    ORDER BY start_date ASC, id ASC
    LIMIT ${limit + 1}
  `) as unknown as PeriodRowWithTotal[];


  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const total = rows.length ? Number(rows[0].total_count) : 0;

  const nextCursor =
    hasMore && sliced.length
      ? Buffer.from(`${sliced[sliced.length - 1].start_date}|${sliced[sliced.length - 1].id}`, 'utf8').toString('base64')
      : null;

  return {
    items: sliced.map(({ total_count, ...r }) => r),
    nextCursor,
    total,
  };
}

export async function getPeriodById(periodId: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, start_date::text, end_date::text
    FROM ${sql.unsafe(TABLE)}
    WHERE id = ${periodId}::uuid
    LIMIT 1
  `) as unknown as PeriodRow[];

  return rows[0] ?? null;
}

export async function resolvePeriodByDate(date: string) {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, start_date::text, end_date::text
    FROM ${sql.unsafe(TABLE)}
    WHERE start_date <= ${date}::date
      AND end_date   > ${date}::date
    ORDER BY start_date DESC
    LIMIT 1
  `) as unknown as PeriodRow[];

  return rows[0] ?? null;
}

export async function createPeriod(body: {
  start_date: string;
  end_date: string;
}) {
  const sql = getSql();

  const rows = (await sql`
    INSERT INTO ${sql.unsafe(TABLE)} (start_date, end_date)
    VALUES (${body.start_date}::date, ${body.end_date}::date)
    RETURNING id, start_date::text, end_date::text
  `) as unknown as PeriodRow[];

  return rows[0] ?? null;
}
