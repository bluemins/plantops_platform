import { ModuleId } from "@plantops/types";
import { safeNext } from "@/lib/safe-next";
import { getCurrentUser } from "@/server/auth";
import { HttpError } from "@/server/http";
import { createHandoff } from "@/server/sso";

/** Relative redirect: works the same on localhost, the Wi-Fi address and the real domain. */
const goTo = (location: string) => new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

/**
 * Direct link into a module (phone home-screen icon, launcher tile, "session over" in a module):
 *   GET /sso/start?module=lab_records&next=/batches/12
 * Logged in and allowed -> straight to the module with a one-time code. Not logged in -> login first, then
 * back here. Not allowed / module off -> a plain explanation page. `next` is a path inside the module.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mod = ModuleId.safeParse(url.searchParams.get("module"));
  if (!mod.success) return goTo("/sso/blocked?reason=unknown");
  const next = safeNext(url.searchParams.get("next"));
  const here = `/sso/start?module=${mod.data}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  const user = await getCurrentUser(req);
  if (!user) return goTo(`/login?next=${encodeURIComponent(here)}`);
  if (user.mustChangeSecret) return goTo(`/change-secret?next=${encodeURIComponent(here)}`);

  try {
    const { redirect_url } = await createHandoff(user, mod.data);
    const target = new URL(redirect_url);
    if (next) target.searchParams.set("next", next);
    return goTo(target.toString());
  } catch (err) {
    if (err instanceof HttpError) {
      const reason = err.status === 403 ? "no_access" : "unavailable";
      return goTo(`/sso/blocked?module=${mod.data}&reason=${reason}`);
    }
    throw err;
  }
}
