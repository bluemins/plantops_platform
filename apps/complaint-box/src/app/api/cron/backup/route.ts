import { backupNewFiles, backupRoute } from "@plantops/module-kit/backup";
import { fileStorage } from "@/server/storage";

/** The nightly off-site copy of complaint photos and videos (.github/workflows/backup.yml) - CRON_SECRET header, never browsers. */
export async function POST(req: Request) {
  return backupRoute(req, () => backupNewFiles("complaint_box", fileStorage()));
}
