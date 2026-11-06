import { after } from "next/server";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { CancelInput, cancelPayment } from "@/server/ledger";
import { ledgerCancelNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: cancel a payment with a reason (the bills it paid are due again). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const id = uuidParam((await ctx.params).id);
  const done = await cancelPayment(user, id, await readJson(req, CancelInput));
  after(() => kit.notify(user.tenantId, ledgerCancelNotification(user, "payment", id, { number: done.number, customer: done.customer, amount: done.amount, reason: done.reason })));
  return json({ ok: true });
});
