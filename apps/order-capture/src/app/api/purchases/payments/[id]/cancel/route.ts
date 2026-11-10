import { after } from "next/server";
import { handle, json, readJson, uuidParam } from "@/server/http";
import { kit } from "@/server/kit";
import { CancelPurchaseInput, cancelVendorPayment, purchaseCancelNotification } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: cancel a payment made with a reason (the bills it paid are due again). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  const done = await cancelVendorPayment(user, uuidParam((await ctx.params).id), await readJson(req, CancelPurchaseInput));
  after(() => kit.notify(user.tenantId, purchaseCancelNotification(user, "payment", done)));
  return json({ ok: true });
});
