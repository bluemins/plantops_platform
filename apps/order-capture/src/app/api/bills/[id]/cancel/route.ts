import { after } from "next/server";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { CancelInput, cancelBill } from "@/server/ledger";
import { ledgerCancelNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: cancel a bill with a reason (what was paid on it goes back to those payments as advance). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const id = uuidParam((await ctx.params).id);
  const done = await cancelBill(user, id, await readJson(req, CancelInput));
  after(() => kit.notify(user.tenantId, ledgerCancelNotification(user, "bill", id, { number: done.number, customer: done.customer, amount: done.total, reason: done.reason })));
  return json({ ok: true });
});
