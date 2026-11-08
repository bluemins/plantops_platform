// The customer API's frame (docs/CUSTOMER_APP_PHASE_PLAN.md "Login"): the app id in the `x-drop-app` header names the
// plant (DROP_APPS), never the request body; JSON bodies of at most 2 KB with strict schemas; limits; every error is
// { error: { code, message } } like the WhatsApp bot's API; nothing is cached. Outside the staff login proxy.
import type { z } from "zod";
import { HttpError, rateLimit, readBody } from "../http";
import { kit } from "../kit";
import { dropApp, type DropApp } from "./config";

export type DropCode =
  | "bad_request"
  | "bad_phone"
  | "unknown_app"
  | "wrong_code"
  | "session_ended"
  | "module_off"
  | "rate_limited"
  | "unavailable";

export class DropError extends Error {
  constructor(
    public status: number,
    public code: DropCode,
    message: string,
  ) {
    super(message);
  }
}

const NO_STORE = { "cache-control": "no-store" };

export const dropJson = (data: unknown, status = 200) => Response.json(data, { status, headers: NO_STORE });

function errorResponse(e: DropError) {
  return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status, headers: { ...NO_STORE, ...(e.status === 429 ? { "retry-after": "60" } : {}) } });
}

/** A limit over `windowMs`; over it = 429 rate_limited. */
export function dropLimit(key: string, max: number, windowMs: number) {
  try {
    rateLimit(key, max, windowMs);
  } catch (err) {
    if (err instanceof HttpError) throw new DropError(429, "rate_limited", "Too many tries. Please wait a little and try again.");
    throw err;
  }
}

/** The app this request comes from (header `x-drop-app`), with its plant's Sales switched on. */
export async function appOf(req: Request): Promise<DropApp> {
  const app = dropApp(req.headers.get("x-drop-app"));
  if (!app) throw new DropError(401, "unknown_app", "This app is not set up");
  const plan = await kit.plan(app.tenantId);
  if (!plan) throw new DropError(503, "unavailable", "Please try again in a minute");
  if (!plan.enabled_modules.includes("order_capture")) throw new DropError(403, "module_off", "This service is switched off");
  return app;
}

const BODY_MAX = 2 * 1024;

/** A JSON body checked against `schema` (400 bad_request otherwise). */
export async function dropBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new DropError(400, "bad_request", "Expected a JSON request");
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req, BODY_MAX, "too big")).toString("utf8"));
  } catch {
    throw new DropError(400, "bad_request", "The body must be JSON of at most 2 KB");
  }
  const input = schema.safeParse(body);
  if (!input.success) throw new DropError(400, "bad_request", "Invalid request");
  return input.data;
}

/** Wraps a customer-API route: errors in the agreed shape; anything unexpected is logged and answered 503. */
export function dropRoute(fn: (req: Request) => Promise<Response>) {
  return async (req: Request) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof DropError) return errorResponse(err);
      console.error("[order-capture] Drop API:", err);
      return errorResponse(new DropError(503, "unavailable", "Please try again in a minute"));
    }
  };
}
