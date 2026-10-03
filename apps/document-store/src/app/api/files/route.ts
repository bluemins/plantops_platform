import { handleUpload, json } from "@/server/http";
import { uploadFile } from "@/server/documents";
import { requireApiUser } from "@/server/session";
import { MAX_FILE_BYTES } from "@/server/storage";

/**
 * Upload a document file: the raw file as the body, its type as Content-Type, its name (URL-encoded) in
 * X-File-Name. Returns the file record; the document is then saved with its id.
 */
export const POST = handleUpload(MAX_FILE_BYTES, async (req, body) => {
  const user = await requireApiUser();
  let name = "document";
  try {
    name = decodeURIComponent(req.headers.get("x-file-name") ?? "document");
  } catch {}
  return json(await uploadFile(user, { data: body, name }), { status: 201 });
});
