import { z } from "zod";
import { updateCustomerDetails } from "@/server/customer-details";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** The owner's Edit: calling name, place, mobile (with a reason), GST details, contact, delivery, terms. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await updateCustomerDetails(user, uuidParam((await ctx.params).id), (await readJson(req, z.record(z.string(), z.unknown()))) as never));
});
