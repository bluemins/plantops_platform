// Same JSON request/response helpers as the platform (apps never import each other, so this is a copy).
import { z } from "zod";
import { AccessDeniedError } from "@plantops/auth";

/** Error with an HTTP status and a plain-language message that is safe to show the user. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Please log in") => new HttpError(401, m);
export const forbidden = (m = "You don't have permission to do this") => new HttpError(403, m);
export const notFound = (m = "Not found") => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

/** Wraps a route handler: turns HttpError / access errors into JSON responses, hides anything unexpected. */
export function handle<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      if (!["GET", "HEAD"].includes(req.method)) assertJsonRequest(req);
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      if (err instanceof AccessDeniedError) return json({ error: "You don't have permission to do this" }, { status: 403 });
      console.error(err);
      return json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

/**
 * Mutations must be JSON. A browser form on another website cannot send this content type without a CORS
 * preflight, which (together with SameSite cookies) blocks cross-site request forgery.
 */
function assertJsonRequest(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) throw new HttpError(415, "Expected a JSON request");
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue ? `${issue.path.join(".") || "body"}: ${issue.message}` : "Invalid request");
  }
  return parsed.data;
}

const Uuid = z.uuid();
/** Path ids that aren't UUIDs simply don't exist. */
export function uuidParam(value: string) {
  if (!Uuid.safeParse(value).success) throw notFound();
  return value;
}
