// Step 4 of the login flow (CLAUDE.md): the platform sends the user here with a one-time code. We swap it
// server-to-server for the SSO token, verify it with the platform's public key, check access, and start
// this module's own 12-hour session. The token itself never reaches the browser.
import { NextResponse, type NextRequest } from "next/server";
import { startModuleSession } from "@plantops/auth";
import { messagePage } from "@/server/html";
import { creds, keys } from "@/server/platform";
import { safeNext } from "@/server/safe-next";
import { sealCookie, sessionCookie } from "@/server/session-cookie";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return messagePage(400, "This login link is incomplete. Please open Lab Records from PlantOps again.");
  try {
    const session = await startModuleSession(creds(), code, keys());
    // A relative Location: the browser stays on the address it used. (req.url is the server's own
    // listening address, e.g. http://0.0.0.0:3001 in phone mode or an internal one behind a proxy.)
    const res = new NextResponse(null, { status: 307, headers: { location: safeNext(req.nextUrl.searchParams.get("next")) } });
    res.cookies.set(sessionCookie(await sealCookie(session)));
    return res;
  } catch (err) {
    console.error("[lab-records] login handoff failed:", (err as Error).message);
    return messagePage(403, "Could not log you in to Lab Records (the link may have expired or been used already). Please try again from PlantOps.");
  }
}
