import { handle, json } from "@/server/http";
import { requireSuperAdmin } from "@/server/super-auth";

export const GET = handle(async (req) => json(await requireSuperAdmin(req)));
