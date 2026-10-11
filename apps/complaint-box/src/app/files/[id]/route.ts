import { HttpError, uuidParam } from "@/server/http";
import { parseRange, readComplaintFile } from "@/server/files";
import { currentUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/**
 * View a complaint's photo or play its video - only the viewer's own plant. Answers byte ranges (206), which iPhone
 * Safari needs to play a video. PlantOps support views are logged.
 */
export async function GET(req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Please log in again", { status: 401 });
  try {
    const file = await readComplaintFile(user, uuidParam((await ctx.params).id));
    const size = file.data.length;
    const headers: Record<string, string> = {
      "content-type": file.contentType,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      "content-disposition": "inline",
      ...(file.kind === "photo" ? { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
    };
    const range = parseRange(req.headers.get("range"), size);
    if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    if (!range) return new Response(new Uint8Array(file.data), { headers: { ...headers, "content-length": String(size) } });
    const part = file.data.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(part), {
      status: 206,
      headers: { ...headers, "content-length": String(part.length), "content-range": `bytes ${range.start}-${range.end}/${size}` },
    });
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
