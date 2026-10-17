import { fetchLogo } from "@plantops/auth";
import { kit } from "@/server/kit";
import { resolvePublicPlant } from "@/server/public";

type Ctx = { params: Promise<{ code: string }> };

/**
 * The plant's logo for its public job page (no login). Only for a plant that passes the same lookup as the page;
 * anything else is a plain 404. Served as a picture only (nosniff), cached an hour.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const plant = await resolvePublicPlant((await ctx.params).code).catch(() => null);
  const b = plant ? await kit.branding(plant.tenantId) : null;
  const logo = b?.logo_url ? await fetchLogo(kit.creds(), b.logo_url).catch(() => null) : null;
  if (!logo) return new Response(null, { status: 404 });
  return new Response(logo.data, { headers: { "content-type": logo.type, "x-content-type-options": "nosniff", "cache-control": "public, max-age=3600" } });
}
