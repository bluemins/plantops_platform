import { backupNewFiles, backupRoute } from "@plantops/module-kit/backup";
import { fileStorage } from "@/server/storage";

/** The nightly off-site copy of bill photos (.github/workflows/backup.yml) - CRON_SECRET header, never browsers. */
export async function POST(req: Request) {
  return backupRoute(req, () => backupNewFiles("attendance_salary", fileStorage()));
}
