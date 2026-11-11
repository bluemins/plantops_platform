import { after } from "next/server";
import { addEntry, EntryInput } from "@/server/cash";
import { expenseNotification } from "@/server/cash-notify";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: an expense, staff cash or money in / out on a day after the last close. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const e = await addEntry(user, await readJson(req, EntryInput));
  const n = expenseNotification(user, e);
  if (n) after(() => kit.notify(user.tenantId, n));
  return json(e, { status: 201 });
});
