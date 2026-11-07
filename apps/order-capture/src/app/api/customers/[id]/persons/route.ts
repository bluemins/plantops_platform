import { z } from "zod";
import { addPerson } from "@/server/customer-details";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Add a contact person to a customer (owner). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await addPerson(user, uuidParam((await ctx.params).id), (await readJson(req, z.record(z.string(), z.unknown()))) as never));
});
