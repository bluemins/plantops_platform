import { collectionSearch } from "@/server/collections";
import { handle, json } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** The collection screen: customers by any part of the name or phone digits, 20 L customers first. */
export const GET = handle(async (req) => {
  const user = await requireApiUser();
  return json(await collectionSearch(user, new URL(req.url).searchParams.get("q") ?? ""));
});
