import { addFix, AddInput } from "@/server/fixes";
import { after } from "next/server";
import { handle, json, readJson } from "@/server/http";
import { kit } from "@/server/kit";
import { requireApiUser } from "@/server/session";

/** Owner: add a forgotten IN or OUT for a person, with a reason (409 if their day changed since the page loaded). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  const { notice, ...answer } = await addFix(user, await readJson(req, AddInput));
  if (notice) after(() => kit.notify(user.tenantId, notice)); // "your attendance was changed", to the worker, after the answer
  return json(answer, { status: 201 });
});
