import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";
import { getSettings, setSettings, SettingsInput } from "@/server/settings";

/** Floor Stock settings (the evening reminder hour). Anyone who sees the counts may read them. */
export const GET = handle(async () => json(await getSettings(await requireApiUser())));

/** Owner only: change the evening reminder hour (5 pm - 11 pm, or off). */
export const PUT = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setSettings(user, await readJson(req, SettingsInput)));
});
