import { after } from "next/server";
import { closeDay, CloseInput } from "@/server/cash";
import { closeNotifications } from "@/server/cash-notify";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { requireApiUser } from "@/server/session";

/** Owner, Accounts: close a day with the cash counted; owner: correct the last close (new version, with a reason). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const c = await closeDay(user, await readJson(req, CloseInput));
  after(async () => {
    for (const n of closeNotifications(user, c)) await kit.notify(user.tenantId, n);
  });
  return json(c, { status: 201 });
});
