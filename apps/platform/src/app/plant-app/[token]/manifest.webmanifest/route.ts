import { manifestFor, plantApp, readAppToken } from "@/server/app-icon";

type Ctx = { params: Promise<{ token: string }> };

/** One plant's install details: its name, colour and logo icons. Signed link, no login (src/server/app-icon.ts). */
export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const tenantId = readAppToken(token);
  const app = tenantId ? await plantApp(tenantId) : null;
  if (!app) return new Response("Not found", { status: 404 });
  return Response.json(manifestFor(app, `/plant-app/${token}`), {
    headers: { "content-type": "application/manifest+json", "cache-control": "private, max-age=300" },
  });
}
