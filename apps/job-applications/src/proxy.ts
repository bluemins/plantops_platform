// Runs before the PROTECTED pages and APIs only: 12 h shift, 5-minute platform re-check, platform login for anyone
// without a session, support view read-only (shared module kit). Pages and APIs check again themselves.
import type { NextRequest } from "next/server";
import { kit } from "./server/kit";

export function proxy(req: NextRequest) {
  return kit.proxy(req);
}

export const config = {
  // Unlike the other modules, this lists the protected paths only: "/", "/<plant code>", the public send
  // (/api/apply/...) and the public logo (/api/public/...) are for job seekers without a login. Login / support
  // callbacks, the tile numbers (own signed ticket), /health and the scheduled jobs (own secret) stay outside too.
  matcher: ["/applications/:path*", "/openings/:path*", "/changes/:path*", "/support-access/:path*", "/api/app/:path*"],
};
