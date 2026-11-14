import { requireUser } from "@/server/auth";
import { addCard, boardDay, indiaToday, NewCardInput } from "@/server/board";
import { handle, json, readJson } from "@/server/http";

/** One day of the Plant board (`?date=YYYY-MM-DD`, default today). Every logged-in plant user, any role. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const day = new URL(req.url).searchParams.get("date");
  return json(await boardDay(user, day || indiaToday()));
});

/** Adds a card for today or a day ahead. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  return json(await addCard(user, await readJson(req, NewCardInput)), { status: 201 });
});
