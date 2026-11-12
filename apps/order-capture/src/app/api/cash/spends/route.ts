import { addSpend, SpendInput } from "@/server/staff-cash";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: what a person paid out of cash given to them for plant spending (no money moves in the box). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await addSpend(user, await readJson(req, SpendInput)), { status: 201 });
});
