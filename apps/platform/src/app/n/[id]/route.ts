import { getCurrentUser } from "@/server/auth";
import { HttpError, uuidParam } from "@/server/http";
import { openNotification } from "@/server/notifications";

type Ctx = { params: Promise<{ id: string }> };

// Relative redirects: an absolute URL built from the request sent phones to 0.0.0.0 once (see /sso/callback).
const go = (location: string) => new Response(null, { status: 303, headers: { location } });

/** Tap on a notification (bell or phone): mark it read, then open the module page through /sso/start. */
export async function GET(_req: Request, ctx: Ctx) {
  const raw = (await ctx.params).id;
  const user = await getCurrentUser(_req);
  if (!user) return go(`/login?next=${encodeURIComponent(`/n/${raw}`)}`);
  if (user.mustChangeSecret) return go(`/change-secret?next=${encodeURIComponent(`/n/${raw}`)}`);
  try {
    return go(await openNotification(user, uuidParam(raw)));
  } catch (err) {
    if (err instanceof HttpError) return go("/home?launcher=1");
    throw err;
  }
}
