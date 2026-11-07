import { z } from "zod";
import { setPersonActive } from "@/server/customer-details";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string; pid: string }> };

/** Switch a contact person off / on (owner); never deleted. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const { id, pid } = await ctx.params;
  const { active } = await readJson(req, z.object({ active: z.boolean() }));
  return json(await setPersonActive(user, uuidParam(id), uuidParam(pid), active));
});
