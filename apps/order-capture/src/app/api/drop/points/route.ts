import { pointsSettingsView, PointsSettingsInput, savePointsSettings } from "@/server/drop/points";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Drop points settings (owner; support reads). */
export const GET = handle(async () => json(await pointsSettingsView(await requireApiUser())));

/** Owner: new points settings, from a date (the history keeps the earlier ones). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await savePointsSettings(user, await readJson(req, PointsSettingsInput)));
});
