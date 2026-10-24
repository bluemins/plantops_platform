import { botGet, botOrderByKey } from "@/server/bot";

/** WhatsApp bot, after a timeout: the order this key made (200), or 404 not_found (then create again, same key). */
export const GET = botGet<{ key: string }>(async (key, { key: idempotencyKey }) => Response.json(await botOrderByKey(key, idempotencyKey)));
