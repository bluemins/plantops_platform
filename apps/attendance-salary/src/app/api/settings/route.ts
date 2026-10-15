import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { saveSettings, settingsFor, SettingsInput } from "@/server/settings";

/** The plant's point and circle (owner; PlantOps support may read). */
export const GET = handle(async () => json(await settingsFor(await requireApiUser())));

export const PUT = handle(async (req) => {
  const user = await requireApiUser();
  return json(await saveSettings(user, await readJson(req, SettingsInput)));
});
