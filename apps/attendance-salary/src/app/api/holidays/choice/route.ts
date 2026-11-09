import { ChoiceInput, setChoice } from "@/server/holidays";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner only: marks a festival as the person's choice leave for its group, or undoes it (rule 24). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await setChoice(user, await readJson(req, ChoiceInput)));
});
