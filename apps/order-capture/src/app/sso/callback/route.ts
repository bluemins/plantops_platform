import type { NextRequest } from "next/server";
import { kit } from "@/server/kit";

// Standard module route, from the shared module kit (packages/module-kit).
export function GET(req: NextRequest) {
  return kit.routes.callback(req);
}
