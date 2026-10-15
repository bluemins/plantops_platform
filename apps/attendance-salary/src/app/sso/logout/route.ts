import { kit } from "@/server/kit";

// Standard module route, from the shared module kit (packages/module-kit).
export function GET() {
  return kit.routes.logout();
}
