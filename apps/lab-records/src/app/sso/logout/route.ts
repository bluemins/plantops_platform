import { NextResponse } from "next/server";
import { accountUrl } from "@/server/platform";
import { SESSION_COOKIE } from "@/server/session-cookie";

/** Leaves Lab Records (this module's session only) and goes back to PlantOps. */
export async function GET() {
  const res = NextResponse.redirect(accountUrl());
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
