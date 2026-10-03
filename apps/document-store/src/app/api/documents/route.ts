import { createDocument, DocumentInput } from "@/server/documents";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** A new document (version 1) with its uploaded file (owner / document keeper). */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await createDocument(user, await readJson(req, DocumentInput)), { status: 201 });
});
