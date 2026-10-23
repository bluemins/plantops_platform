import { botContext, botRoute, ContextInput } from "@/server/bot";

/** WhatsApp bot (server to server, bot key): who is this phone, which products, their last delivered order. Read-only. */
export const POST = botRoute(ContextInput, async (key, input) => Response.json(await botContext(key, input)));
