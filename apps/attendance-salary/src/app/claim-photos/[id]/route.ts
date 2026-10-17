import { readClaimPhoto } from "@/server/claims";
import { HttpError, uuidParam } from "@/server/http";
import { currentUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A bill photo: only to its claim's own person, the owner or PlantOps support (logged). Anyone else: 404. */
export async function GET(_req: Request, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Please log in again", { status: 401 });
  try {
    const photo = await readClaimPhoto(user, uuidParam((await ctx.params).id));
    return new Response(new Uint8Array(photo.data), {
      headers: {
        "content-type": photo.contentType,
        "content-length": String(photo.data.length),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "content-disposition": "inline",
        "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
