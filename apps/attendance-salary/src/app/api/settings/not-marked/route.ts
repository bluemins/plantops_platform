import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { NotMarkedInput, saveNotMarkedHour } from "@/server/settings";

/** Owner: the hour of the morning "not marked" alert (08:00-11:00) or Off (`hour: null`). */
export const PUT = handle(async (req) => {
  const user = await requireApiUser();
  return json(await saveNotMarkedHour(user, await readJson(req, NotMarkedInput)));
});
