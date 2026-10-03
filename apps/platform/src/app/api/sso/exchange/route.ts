import { z } from "zod";
import { handle, json, readJson } from "@/server/http";
import { authenticateModule, exchangeHandoffCode } from "@/server/sso";

const Body = z.object({ code: z.string().min(1).max(200) });

/** Server-to-server only: called by a module's /sso/callback with its module id + secret. */
export const POST = handle(async (req) => {
  const moduleId = await authenticateModule(req);
  const { code } = await readJson(req, Body);
  return json(await exchangeHandoffCode(moduleId, code), { headers: { "cache-control": "no-store" } });
});
