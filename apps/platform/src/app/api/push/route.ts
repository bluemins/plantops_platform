import { z } from "zod";
import { requireUser } from "@/server/auth";
import { env } from "@/server/env";
import { handle, json, readJson } from "@/server/http";
import { isSubscribed, subscribe, SubscriptionInput, unsubscribe } from "@/server/notifications";

/** The public key the browser needs to turn notifications on (null = not set up), and whether this phone is on. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  return json({ public_key: env.vapid?.publicKey ?? null, subscribed: endpoint ? await isSubscribed(user, endpoint) : false });
});

/** This phone turns notifications on for the logged-in user. */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  await subscribe(user, await readJson(req, SubscriptionInput), req.headers.get("user-agent"));
  return json({ ok: true }, { status: 201 });
});

/** This phone turns notifications off (also called just before logout). */
export const DELETE = handle(async (req) => {
  const user = await requireUser(req, { allowMustChange: true });
  const { endpoint } = await readJson(req, z.object({ endpoint: z.string().max(1000) }));
  return json({ removed: await unsubscribe(user, endpoint) });
});
