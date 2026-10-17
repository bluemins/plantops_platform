import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { payMonth, PayInput } from "@/server/salary-pay";
import { requireApiUser } from "@/server/session";

/** Owner: tick a person's month Paid (freezes its figures; 409 if already paid or the figures changed). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { notice, ...answer } = await payMonth(user, await readJson(req, PayInput));
  if (notice) after(() => kit.notify(user.tenantId, notice)); // "your salary is paid", to that worker only, after the answer
  return json(answer, { status: 201 });
});
