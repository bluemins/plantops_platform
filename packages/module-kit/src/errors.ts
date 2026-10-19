// Server errors go to the platform's error log (STABILITY_PLAN B-09), seen by super_admin on /super/errors.
// createModule() registers the sender once (the app's instrumentation.ts imports the kit at server start); handle()
// and the app's onRequestError call reportError(). Reporting never throws and never holds up the answer to the user.
import { buildErrorReport, type ErrorReport } from "@plantops/types";

export interface ErrorWhere {
  method: string;
  /** a path or a full URL; the query string is dropped */
  path: string;
  kind: ErrorReport["kind"];
  /** the request's Cookie header: the module reads which plant / user it was from its own session cookie */
  cookie?: string | null;
}

type Reporter = (err: unknown, where: ErrorWhere) => Promise<void>;

// On globalThis: Next may load this file more than once (route bundles), the reporter must be the same everywhere.
const g = globalThis as unknown as { __plantopsErrorReporter?: Reporter };

/** createModule() calls this once with its sender. */
export function reportErrorsTo(reporter: Reporter | null) {
  g.__plantopsErrorReporter = reporter ?? undefined;
}

/** Sends one error to the platform's log. Never throws; without a reporter (tests, scripts) it does nothing. */
export async function reportError(err: unknown, where: ErrorWhere) {
  const reporter = g.__plantopsErrorReporter;
  if (!reporter) return;
  try {
    const path = /^https?:\/\//.test(where.path) ? new URL(where.path).pathname : where.path;
    await reporter(err, { ...where, path });
  } catch (e) {
    console.error("[error-log] not sent:", (e as Error).message);
  }
}

/** The cookie `name` from a Cookie header. */
export function cookieFrom(header: string | null | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

/** Next's routeType (instrumentation onRequestError) as an error-log kind. */
export function kindOf(routeType: string | undefined): ErrorReport["kind"] {
  return routeType === "render" ? "page" : routeType === "action" ? "action" : routeType === "proxy" ? "proxy" : "api";
}

export { buildErrorReport };
