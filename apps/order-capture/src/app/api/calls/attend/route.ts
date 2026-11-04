import { attendCall, AttendInput } from "@/server/calls-tab";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Mark a number Attended (owner, Order desk, Delivery staff); a new caller can be saved to the customer list. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await attendCall(user, await readJson(req, AttendInput)));
});
