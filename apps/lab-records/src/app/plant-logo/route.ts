import { fetchLogo } from "@plantops/auth";
import { branding, creds } from "@/server/platform";
import { currentUser } from "@/server/session";

/** The user's own plant logo, fetched from the platform with this module's credentials. */
export async function GET() {
  const user = await currentUser();
  const b = user && (await branding(user.tenantId));
  const logo = b?.logo_url ? await fetchLogo(creds(), b.logo_url).catch(() => null) : null;
  if (!logo) return new Response(null, { status: 404 });
  return new Response(logo.data, {
    headers: { "content-type": logo.type, "x-content-type-options": "nosniff", "cache-control": "private, max-age=300" },
  });
}
