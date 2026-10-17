import { handle, json } from "@/server/http";
import { plantByCode } from "@/server/plant-lookup";

type Ctx = { params: Promise<{ code: string }> };

/** Server-to-server (Job applications only): which plant a public job page belongs to. Same 404 for every refusal. */
export const GET = handle(async (req, ctx: Ctx) => json(await plantByCode(req, (await ctx.params).code)));
