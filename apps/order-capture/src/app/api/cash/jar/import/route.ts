import { JarImportInput, jarImport } from "@/server/collections";
import { handle, json, readJson } from "@/server/http";
import { requireApiUser } from "@/server/session";

/** Owner: save the 20 L import (customers, "20 L" marks, opening balances), all or nothing. */
export const POST = handle(async (req) => {
  const user = await requireApiUser();
  return json(await jarImport(user, await readJson(req, JarImportInput)), { status: 201 });
});
