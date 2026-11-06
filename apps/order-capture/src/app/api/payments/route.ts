import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { ReceivePaymentInput, receivePayment } from "@/server/ledger";
import { paymentNotification } from "@/server/notify";
import { requireApiUser } from "@/server/session";

/** Receive a payment from a customer (owner, Order desk): oldest bills first, or the bills ticked; the rest is advance. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const p = await receivePayment(user, await readJson(req, ReceivePaymentInput));
  after(() => kit.notify(user.tenantId, paymentNotification(user, p)));
  return json(p, { status: 201 });
});
