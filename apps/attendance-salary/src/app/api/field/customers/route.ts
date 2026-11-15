import { searchCustomers } from "@/server/field";
import { handle, json } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** The visit screen's customer search (?q=), through Sales with a lookup ticket the browser never sees. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  return json(await searchCustomers(user, new URL(req.url).searchParams.get("q") ?? ""));
});
