import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { SUPPORT_COOKIE } from "@/server/session-cookie";

/** Ends the support view and goes back to the super_admin plant dashboard. */
export async function GET() {
  const res = NextResponse.redirect(new URL("/super/dashboard", env.platformUrl));
  res.cookies.delete(SUPPORT_COOKIE);
  return res;
}
