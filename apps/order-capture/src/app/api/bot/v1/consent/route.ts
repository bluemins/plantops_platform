import { botConsent, botRoute, ConsentInput } from "@/server/bot";

/** WhatsApp bot: a customer's answer about reorder reminders (yes / no after an order, STOP, START, "Stop reminders"). */
export const POST = botRoute(ConsentInput, async (key, input) => Response.json(await botConsent(key, input)));
