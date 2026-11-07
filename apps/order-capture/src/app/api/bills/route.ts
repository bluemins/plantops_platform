import { handle, json, readJson } from "@/server/http";
import { MakeBillInput, makeBill } from "@/server/bill-make";
import { requireApiUser } from "@/server/session";

/** Make a delivered order's bill (owner, Accounts). The customer's advances pay it first. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await makeBill(user, await readJson(req, MakeBillInput)), { status: 201 });
});
