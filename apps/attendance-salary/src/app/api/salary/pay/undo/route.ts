import { handle, json, readJson } from "@/server/http";
import { undoPayment, UndoInput } from "@/server/salary-pay";
import { requireApiUser } from "@/server/session";

/** Owner: undo a payment, with a reason (once). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await undoPayment(user, await readJson(req, UndoInput)), { status: 201 });
});
