import { handle, json, readJson, uuidParam } from "@/server/http";
import { PaymentModeInput, setPaymentMode } from "@/server/purchase-entry";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner, Accounts: correct how a payment was really made (mode, paid from). */
export const POST = handle(async (req, ctx: Ctx) => {
  const user = await requireApiUser();
  return json(await setPaymentMode(user, uuidParam((await ctx.params).id), await readJson(req, PaymentModeInput)));
});
