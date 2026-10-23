import { after } from "next/server";
import { AlertInput, botAlert, botRoute } from "@/server/bot";
import { kit } from "@/server/kit";

/** WhatsApp bot: a "Not great" rating or "talk to a person" becomes a notification, sent after the answer. */
export const POST = botRoute(AlertInput, async (key, input) => {
  const note = await botAlert(key, input);
  after(() => kit.notify(key.tenant_id, note));
  return Response.json({ sent: true }, { status: 202 });
});
