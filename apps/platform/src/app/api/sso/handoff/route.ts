import { z } from "zod";
import { ModuleId } from "@plantops/types";
import { requireUser } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { createHandoff } from "@/server/sso";

const Body = z.object({ module: ModuleId });

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const { module } = await readJson(req, Body);
  return json(await createHandoff(user, module));
});
