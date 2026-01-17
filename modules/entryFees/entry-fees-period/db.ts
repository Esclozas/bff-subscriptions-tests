// modules/entry-fees/db.ts
import { neon, Pool } from '@neondatabase/serverless';

let _sql: ReturnType<typeof neon> | null = null;
function getSql() {
  if (_sql) return _sql;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _sql = neon(url);
  return _sql;
}

let _pool: Pool | null = null;
function getPool() {
  if (_pool) return _pool;
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL is not set');
  _pool = new Pool({ connectionString: url });
  return _pool;
}

const TABLE = 'entry_fees_period';

export type EntryFeesPeriod = {
  id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD (exclusif)
  created_by?: string | null; // si tu ajoutes la colonne plus tard
};

export type EntryFeesPeriodBatchCreate = {
  start_date: string;
  end_date: string;
};

export type EntryFeesPeriodBatchUpdate = {
  id: string;
  start_date: string;
  end_date: string;
};

export type EntryFeesPeriodBatchDelete = {
  id: string;
};

export type EntryFeesPeriodBatchInput = {
  create: EntryFeesPeriodBatchCreate[];
  update: EntryFeesPeriodBatchUpdate[];
  delete: EntryFeesPeriodBatchDelete[];
};

export type EntryFeesPeriodBatchResult = {
  create: EntryFeesPeriod[];
  update: EntryFeesPeriod[];
  delete: string[];
};

export type EntryFeesPeriodBatchOp = 'create' | 'update' | 'delete';
export type EntryFeesPeriodBatchContext = { op: EntryFeesPeriodBatchOp; index: number };

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

export async function deletePeriodById(periodId: string) {
  const sql = getSql();

  const rows = (await sql`
    DELETE FROM ${sql.unsafe(TABLE)}
    WHERE id = ${periodId}::uuid
    RETURNING id
  `) as unknown as { id: string }[];

  return rows[0]?.id ?? null; // null = not found
}

export async function updatePeriodById(
  periodId: string,
  body: { start_date: string; end_date: string }
) {
  const sql = getSql();

  type Row = {
    id: string;
    start_date: string;
    end_date: string;
  };

  const rows = (await sql`
    UPDATE ${sql.unsafe(TABLE)}
    SET
      start_date = ${body.start_date}::date,
      end_date   = ${body.end_date}::date
    WHERE id = ${periodId}::uuid
    RETURNING id, start_date::text, end_date::text
  `) as unknown as Row[];

  return rows[0] ?? null; // null = not found
}

function attachBatchContext(err: any, ctx: EntryFeesPeriodBatchContext) {
  return Object.assign(err, { _batch: ctx });
}

export async function applyEntryFeesPeriodBatch(
  input: EntryFeesPeriodBatchInput,
  options?: { dryRun?: boolean },
): Promise<EntryFeesPeriodBatchResult> {
  const createItems = input.create ?? [];
  const updateItems = input.update ?? [];
  const deleteItems = input.delete ?? [];

  if (!createItems.length && !updateItems.length && !deleteItems.length) {
    return { create: [], update: [], delete: [] };
  }

  const pool = getPool();
  const client = await pool.connect();
  const results: EntryFeesPeriodBatchResult = { create: [], update: [], delete: [] };

  try {
    await client.query('BEGIN');

    for (let i = 0; i < deleteItems.length; i += 1) {
      const item = deleteItems[i];
      try {
        const res = await client.query<{ id: string }>(
          `DELETE FROM ${TABLE} WHERE id = $1::uuid RETURNING id`,
          [item.id],
        );
        if (res.rows[0]?.id) {
          results.delete.push(res.rows[0].id);
        }
      } catch (err: any) {
        throw attachBatchContext(err, { op: 'delete', index: i });
      }
    }

    for (let i = 0; i < updateItems.length; i += 1) {
      const item = updateItems[i];
      try {
        const res = await client.query<PeriodRow>(
          `UPDATE ${TABLE}
           SET start_date = $2::date, end_date = $3::date
           WHERE id = $1::uuid
           RETURNING id, start_date::text, end_date::text`,
          [item.id, item.start_date, item.end_date],
        );
        const row = res.rows[0];
        if (!row) {
          const notFound = Object.assign(new Error('Period not found'), { code: 'PERIOD_NOT_FOUND' });
          throw attachBatchContext(notFound, { op: 'update', index: i });
        }
        results.update.push(row);
      } catch (err: any) {
        if (err?._batch) throw err;
        throw attachBatchContext(err, { op: 'update', index: i });
      }
    }

    for (let i = 0; i < createItems.length; i += 1) {
      const item = createItems[i];
      try {
        const res = await client.query<PeriodRow>(
          `INSERT INTO ${TABLE} (start_date, end_date)
           VALUES ($1::date, $2::date)
           RETURNING id, start_date::text, end_date::text`,
          [item.start_date, item.end_date],
        );
        if (res.rows[0]) {
          results.create.push(res.rows[0]);
        }
      } catch (err: any) {
        throw attachBatchContext(err, { op: 'create', index: i });
      }
    }

    if (options?.dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    return results;
  } catch (err: any) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
