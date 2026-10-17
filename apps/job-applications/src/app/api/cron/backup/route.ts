import { backupNewFiles, backupRoute } from "@plantops/module-kit/backup";
import { fileStorage } from "@/server/storage";

/** Nightly encrypted copy of new resume files to the backup bucket (backup.yml; CRON_SECRET). */
export async function POST(req: Request) {
  return backupRoute(req, () => backupNewFiles("job_applications", fileStorage()));
}
