import type { NextRequest } from "next/server";
import { HttpError, uuidParam } from "@/server/http";
import { readPurchaseBillCopy } from "@/server/purchase-files";
import { currentUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** A purchase bill copy (?download=1 to save): owner, Accounts, PlantOps support (logged). Anyone else: 404 / 403. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Please log in again", { status: 401 });
  try {
    const f = await readPurchaseBillCopy(user, uuidParam((await ctx.params).id));
    const name = f.fileName ?? (f.contentType === "application/pdf" ? "bill-copy.pdf" : `bill-copy.${f.contentType.split("/")[1]}`);
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
    return new Response(new Uint8Array(f.data), {
      headers: {
        "content-type": f.contentType,
        "content-length": String(f.data.length),
        "content-disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        ...(f.contentType.startsWith("image/") ? { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
