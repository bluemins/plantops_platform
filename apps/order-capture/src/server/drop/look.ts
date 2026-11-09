// The plant's look for the Drop app (docs/CUSTOMER_APP_PHASE_PLAN.md Phase 5: "brand colour and logo from the API, no
// Bluemins look hard-coded"). Needs only the app id (the login screen shows it before anyone logs in), so it gives an
// allow-list of public things only: the plant's name, brand colour, whether it has a logo, and its customer support
// phone and hours (Business details).
import { fetchLogo } from "@plantops/auth";
import { kit } from "../kit";
import { appOf, DropError } from "./api";

export async function appLook(req: Request) {
  const app = await appOf(req);
  const b = await kit.branding(app.tenantId);
  if (!b) throw new DropError(503, "unavailable", "Please try again in a minute");
  return {
    name: b.name,
    brand_color: b.brand_color && /^#[0-9a-f]{6}$/i.test(b.brand_color) ? b.brand_color : null,
    has_logo: !!b.logo_url,
    support: b.support_phone ? { phone: b.support_phone, hours: b.support_hours ?? null } : null,
  };
}

/** The plant's logo image (404 when it has none). */
export async function appLogo(req: Request) {
  const app = await appOf(req);
  const b = await kit.branding(app.tenantId);
  const logo = b?.logo_url ? await fetchLogo(kit.creds(), b.logo_url).catch(() => null) : null;
  if (!logo) throw new DropError(404, "not_offered", "No logo");
  return new Response(logo.data, { headers: { "content-type": logo.type, "x-content-type-options": "nosniff", "cache-control": "public, max-age=3600" } });
}
