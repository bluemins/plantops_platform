import { handle, json } from "@/server/http";
import { listErrors } from "@/server/errors";
import { requireSuperAdmin } from "@/server/super-auth";

/** super_admin: the error log of the last 7 days, grouped (STABILITY_PLAN B-09). */
export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return json(await listErrors());
});
