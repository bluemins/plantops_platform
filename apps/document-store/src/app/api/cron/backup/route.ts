import { backupNewFiles, backupRoute } from "@plantops/module-kit/backup";
import { fileStorage } from "@/server/storage";

/** The nightly off-site copy of uploaded files (.github/workflows/backup.yml) - CRON_SECRET header, never browsers. */
export async function POST(req: Request) {
  return backupRoute(req, () => backupNewFiles("document_store", fileStorage()));
}
