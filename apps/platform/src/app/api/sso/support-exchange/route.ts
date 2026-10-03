import { z } from "zod";
import { handle, json, readJson } from "@/server/http";
import { authenticateModule } from "@/server/sso";
import { exchangeSupportCode } from "@/server/support";

const Body = z.object({ code: z.string().min(1).max(200) });

/** Server-to-server only: a module's /sso/support swaps the one-time code for a read-only support token. */
export const POST = handle(async (req) => {
  const moduleId = await authenticateModule(req);
  const { code } = await readJson(req, Body);
  return json(await exchangeSupportCode(moduleId, code), { headers: { "cache-control": "no-store" } });
});
