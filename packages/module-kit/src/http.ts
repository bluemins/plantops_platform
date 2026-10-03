// JSON request/response helpers for module apps (same rules as the platform: JSON-only mutations, safe errors).
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
/** Older than the plan's history window: kept, but not shown until the plant upgrades. */
export const hiddenByPlan = () => new HttpError(410, "This record is older than your plan's history window. It is kept safely; ask PlantOps to extend the plan to see it.");

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

/**
 * Wraps a file-upload route: the file is the raw request body with its own Content-Type. Types a cross-site
 * HTML form could send (form posts, plain text) are refused, so like JSON calls this can't be triggered from
 * another website (CSRF). The body is read up to `maxBytes`, never more.
 */
export function handleUpload<C>(maxBytes: number, fn: (req: Request, body: Buffer, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!type || ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(type)) {
        throw new HttpError(415, "Send the file itself, not a form");
      }
      const declared = Number(req.headers.get("content-length") ?? 0);
      if (declared > maxBytes) throw new HttpError(413, `Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB`);
      return await fn(req, await readBody(req, maxBytes), ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      if (err instanceof AccessDeniedError) return json({ error: "You don't have permission to do this" }, { status: 403 });
      console.error(err);
      return json({ error: "Something went wrong" }, { status: 500 });
    }
  };
}

async function readBody(req: Request, maxBytes: number): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, `Files can be at most ${Math.round(maxBytes / 1024 / 1024)} MB`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
