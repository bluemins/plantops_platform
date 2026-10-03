import type { NextRequest } from "next/server";
import { readFile } from "@/server/documents";
import { HttpError, uuidParam } from "@/server/http";
import { schema, withTenant } from "@/server/db";
import { currentUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** View (or ?download=1 to save) a document file - only the viewer's own plant. Support views are logged. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const user = await currentUser();
  if (!user) return new Response("Please log in again", { status: 401 });
  try {
    const id = uuidParam((await ctx.params).id);
    const { file, data } = await readFile(user, id);
    if (user.isSupport) {
      await withTenant(user.tenantId, (tx) =>
        tx.insert(schema.supportViews).values({ tenantId: user.tenantId, superAdminId: user.userId, superAdminName: user.name, path: `/files/${id}` }),
      );
    }
    const disposition = req.nextUrl.searchParams.get("download") ? "attachment" : "inline";
    const ascii = file.original_name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": file.content_type,
        "content-length": String(data.length),
        "content-disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        ...(file.content_type.startsWith("image/") ? { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
