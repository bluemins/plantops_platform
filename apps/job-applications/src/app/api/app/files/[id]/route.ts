import { readResumeFile } from "@/server/applications";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

type Ctx = { params: Promise<{ id: string }> };

/**
 * One resume page (a photo, or the PDF), for owner / HR desk / PlantOps support (logged). Shown in the browser, never
 * cached outside it, never sniffed into another type, and a photo is locked down so it can't run anything.
 */
export const GET = handle(async (_req, ctx: Ctx) => {
  const user = await requireApiUser();
  const file = await readResumeFile(user, (await ctx.params).id);
  const name = `resume-page-${file.pageNo}.${file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]}`;
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.type,
      "content-disposition": `inline; filename="${name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
      // photos can't run anything; a PDF opens in the browser's own viewer (as in Document Store)
      ...(file.type.startsWith("image/") ? { "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'" } : {}),
    },
  });
});
