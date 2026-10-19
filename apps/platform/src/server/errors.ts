// Error log (STABILITY_PLAN B-09, owner 2026-10-19): server errors of the platform and of every module (sent to
// POST /api/m/errors), for super_admin only. Rows are written only through platform.log_error() (at most 20 per app
// per minute) and removed after 30 days by platform.purge_old_errors() in the daily job (migration 0017).
import { sql } from "drizzle-orm";
import { buildErrorReport, type ErrorReport } from "@plantops/types";
import { getCurrentUser } from "./auth";
import { appDb, superDb } from "./db";

/** Keeps one error of `app` ("platform" or a module id). Returns false when the per-minute limit dropped it. */
export async function logError(app: string, r: ErrorReport): Promise<boolean> {
  const { rows } = await appDb().execute<{ kept: boolean }>(
    sql`select platform.log_error(${app}, ${r.method}, ${r.path}, ${r.kind}, ${r.message}, ${r.stack}, ${r.tenant_id}::uuid, ${r.user_id}::uuid) as kept`,
  );
  return rows[0]?.kept === true;
}

/**
 * The platform's own errors (handle() and instrumentation's onRequestError). Finds the plant user from the session
 * cookie when it can; never throws.
 */
export async function logPlatformError(err: unknown, req: Request, kind: ErrorReport["kind"]) {
  try {
    const user = await getCurrentUser(req).catch(() => null);
    await logError("platform", buildErrorReport(err, { method: req.method, path: new URL(req.url).pathname, kind, tenant_id: user?.tenantId, user_id: user?.userId }));
  } catch (e) {
    console.error("[error-log] not kept:", (e as Error).message);
  }
}

export type ErrorGroup = {
  app: string;
  kind: string;
  method: string;
  path: string;
  message: string;
  count: number;
  first_at: string;
  last_at: string;
  /** plant codes seen, e.g. ["001"]; empty when no plant was known */
  plants: string[];
  /** the trace of the latest one */
  stack: string | null;
};

/** super_admin: the last `days` days, the same error on the same address grouped, newest first. */
export async function listErrors(days = 7): Promise<{ groups: ErrorGroup[]; yesterday: number; today: number }> {
  const { rows } = await superDb().execute<Omit<ErrorGroup, "count"> & { count: string | number }>(sql`
    select e.app, e.kind, e.method, e.path, e.message, count(*)::int as count,
           min(e.at) as first_at, max(e.at) as last_at,
           coalesce(array_agg(distinct t.code) filter (where t.code is not null), '{}') as plants,
           (array_agg(e.stack order by e.at desc))[1] as stack
      from platform.error_log e
      left join platform.tenants t on t.id = e.tenant_id
     where e.at > now() - make_interval(days => ${days})
     group by e.app, e.kind, e.method, e.path, e.message
     order by max(e.at) desc
     limit 200`);
  const counts = await superDb().execute<{ yesterday: number; today: number }>(sql`
    select count(*) filter (where (at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date - 1)::int as yesterday,
           count(*) filter (where (at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)::int as today
      from platform.error_log where at > now() - interval '3 days'`);
  const iso = (v: unknown) => new Date(v as string).toISOString();
  return {
    groups: rows.map((r) => ({ ...r, count: Number(r.count), first_at: iso(r.first_at), last_at: iso(r.last_at) })),
    yesterday: counts.rows[0]?.yesterday ?? 0,
    today: counts.rows[0]?.today ?? 0,
  };
}

/** Daily job: rows older than 30 days. */
export async function purgeOldErrors(): Promise<number> {
  const { rows } = await appDb().execute<{ n: number }>(sql`select platform.purge_old_errors() as n`);
  return Number(rows[0]?.n ?? 0);
}
