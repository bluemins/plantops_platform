import { Readable } from "node:stream";
import { exportDocumentBundle } from "@/server/export";
import { handle } from "@/server/http";
import { requireApiUser } from "@/server/session";

export const runtime = "nodejs";

/** Owner only: the manifest and every original file from every document version. */
export const GET = handle(async () => {
  const user = await requireApiUser();
  const { stream } = await exportDocumentBundle(user);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="documents-${day}.zip"`,
      "cache-control": "no-store",
    },
  });
});
