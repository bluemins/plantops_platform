import { handle, json, readJson, uuidParam } from "@/server/http";
import { WriteOffInput, writeOff } from "@/server/ledger";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: write off a customer's unpaid bills (money not coming back), with a reason. No undo. */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const id = uuidParam((await ctx.params).id);
  return json(await writeOff(user, id, await readJson(req, WriteOffInput)));
});
