import { pollCsv } from "@/server/drop/polls";
import { handle, uuidParam } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/** Owner: a poll's answers with each shop's real boxes, as a CSV file (formulas neutralised; audited). */
export const GET = handle(async (_req, ctx: Ctx) => {
  const { body, name } = await pollCsv(await requireApiUser(), uuidParam((await ctx.params).id));
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
});
