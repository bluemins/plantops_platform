import { kit } from "@/server/kit";

// Standard module route, from the shared module kit (packages/module-kit). The logged-in viewer's own plant logo;
// the public page gets its logo from its own route (Phase 3).
export function GET() {
  return kit.routes.plantLogo();
}
