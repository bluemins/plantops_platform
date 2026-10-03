// Runs before every page and API request (Next.js "proxy", formerly middleware). Keeps the Lab Records
// session alive the way CLAUDE.md requires: ends it after one shift (12 h), re-checks the user with the
// platform every 5 minutes (disabled user / removed role / plant suspended -> logged out), and sends anyone
// without a session to the platform login, which brings them straight back here.
// Pages and APIs check the session again themselves (server/session.ts) - this is not the only guard.
import { NextResponse, type NextRequest } from "next/server";
import { refreshModuleSession } from "@plantops/auth";
import { creds, platformLoginUrl } from "./server/platform";
import { openCookie, sealCookie, SESSION_COOKIE, sessionCookie } from "./server/session-cookie";

export async function proxy(req: NextRequest) {
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  const opened = await openCookie(cookie);
  const refreshed = opened && (await refreshModuleSession(creds(), opened));

  if (!refreshed) {
    const here = req.nextUrl.pathname + req.nextUrl.search;
    const res = req.nextUrl.pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Please log in again" }, { status: 401 })
      : NextResponse.redirect(platformLoginUrl(here));
    if (cookie) res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  if (!refreshed.changed) return NextResponse.next();

  // Re-checked just now: pass the fresh cookie on to the page (request) and to the browser (response).
  const value = await sealCookie(refreshed.session);
  req.cookies.set(SESSION_COOKIE, value);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(sessionCookie(value));
  return res;
}

export const config = {
  // Not for: Next's own files, the login callback, the platform's tile-number call (it carries its own
  // signed ticket), the health check and the scheduled-job endpoint (its own secret).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sso/|api/plantops/|api/cron/|health).*)"],
};
