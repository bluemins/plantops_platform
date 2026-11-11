import { handle, json, readJson } from "@/server/http";
import { StartInput, startCashBook } from "@/server/cash";
import { requireApiUser } from "@/server/session";

/** Owner: start the cash book with the cash counted in the box (the opening balance). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await startCashBook(user, await readJson(req, StartInput)), { status: 201 });
});
