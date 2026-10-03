import { handle, json } from "@/server/http";
import { listModules } from "@/server/modules-admin";
import { requireSuperAdmin } from "@/server/super-auth";

export const GET = handle(async (req) => {
  await requireSuperAdmin(req);
  return json(await listModules());
});
