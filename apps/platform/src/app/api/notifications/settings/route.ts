import { requireUser } from "@/server/auth";
import { handle, json, readJson } from "@/server/http";
import { setSetting, SettingInput, settingsFor } from "@/server/notifications";

/** This person's notification settings: every kind they can receive, with phone + bell / bell only / off. */
export const GET = handle(async (req) => json(await settingsFor(await requireUser(req))));

/** Changes one of their own choices (urgent kinds can't be changed). */
export const PUT = handle(async (req) => {
  const user = await requireUser(req);
  return json(await setSetting(user, await readJson(req, SettingInput)));
});
