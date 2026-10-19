import { ErrorReport } from "@plantops/types";
import { handle, json, readJson } from "@/server/http";
import { logError } from "@/server/errors";
import { authenticateModule } from "@/server/sso";

/**
 * Server-to-server: a module records one of its server errors (STABILITY_PLAN B-09). The app name comes from the
 * module's credentials, never from the body. At most 20 per module per minute are kept (`kept: false` beyond).
 */
export const POST = handle(async (req) => {
  const moduleId = await authenticateModule(req);
  const report = await readJson(req, ErrorReport);
  return json({ kept: await logError(moduleId, report) }, { status: 201 });
});
