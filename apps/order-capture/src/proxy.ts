// Runs before every page and API request: 12 h shift, 5-minute platform re-check, platform login for anyone
// without a session, support view read-only (shared module kit). Pages and APIs check again themselves.
import type { NextRequest } from "next/server";
import { kit } from "./server/kit";

export function proxy(req: NextRequest) {
  return kit.proxy(req);
}

export const config = {
  // Not for: Next's own files, the login/support callbacks, the platform's tile-number call (own signed ticket),
  // the health check, the scheduled-job endpoint (own secret) and the WhatsApp bot's API (own key).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sso/|api/plantops/|api/cron/|api/bot/|health).*)"],
};
