import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { requireApiUser } from "@/server/session";
import { addVanReport, VanInput, vanShortNotification } from "@/server/van";

/** Owner, Accounts: a van report. The cash handed in goes into the cash book; customer lines wait in To post. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const v = await addVanReport(user, await readJson(req, VanInput));
  const n = vanShortNotification(user, v);
  if (n) after(() => kit.notify(user.tenantId, n));
  return json(v, { status: 201 });
});
