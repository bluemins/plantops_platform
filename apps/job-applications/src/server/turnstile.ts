// Cloudflare Turnstile (free "are you human?" check) on the public form, only when TURNSTILE_SITE_KEY and
// TURNSTILE_SECRET are both set. Without them the other spam rules still apply (docs/HANDBOOK.md says how to switch
// it on). When Cloudflare can't be reached the send is refused ("try again in a minute"), never let through unchecked.
import { env } from "./env";
import { HttpError } from "./http";

export const turnstileOn = () => Boolean(env.turnstileSiteKey && env.turnstileSecret);

export async function checkTurnstile(token: string | null, ip: string) {
  if (!turnstileOn()) return;
  if (!token) throw new HttpError(400, "Please tick the spam check again.");
  let ok = false;
  try {
    const res = await fetch(env.turnstileVerifyUrl, {
      method: "POST",
      body: new URLSearchParams({ secret: env.turnstileSecret, response: token, ...(ip !== "unknown" ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Turnstile answered ${res.status}`);
    ok = ((await res.json()) as { success?: boolean }).success === true;
  } catch (err) {
    console.error("[job_applications] Turnstile check failed:", (err as Error).message);
    throw new HttpError(503, "The spam check isn't working right now. Please try again in a minute.");
  }
  if (!ok) throw new HttpError(400, "Please tick the spam check again.");
}
