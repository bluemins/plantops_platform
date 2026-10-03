// super_admin's read-only "support view" (CLAUDE.md "Support token"): the platform sends them here with a
// one-time code; we swap it for a support token (verifySupportToken) and keep a 15-minute read-only session.
import { NextResponse, type NextRequest } from "next/server";
import { startSupportSession } from "@plantops/auth";
import { messagePage } from "@/server/html";
import { creds, keys } from "@/server/platform";
import { sealSupportCookie, supportCookie } from "@/server/session-cookie";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return messagePage(400, "This support link is incomplete. Open it again from the PlantOps plant dashboard.");
  try {
    const s = await startSupportSession(creds(), code, keys());
    const res = new NextResponse(null, { status: 307, headers: { location: "/" } });
    res.cookies.set(supportCookie(await sealSupportCookie(s), s.expires_at));
    return res;
  } catch (err) {
    console.error("[lab-records] support handoff failed:", (err as Error).message);
    return messagePage(403, "Could not open the support view (the link may have expired or been used). Open it again from the plant dashboard.");
  }
}
