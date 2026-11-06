import { handle, json, readJson } from "@/server/http";
import { MakeBillInput, makeBill } from "@/server/ledger";
import { requireApiUser } from "@/server/session";

/** Make a delivered order's bill (owner, Order desk). The customer's advances pay it first. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await makeBill(user, await readJson(req, MakeBillInput)), { status: 201 });
});
