// Off-site backup copy of a module's stored files (docs/HANDBOOK.md "Backups").
// - Every file is encrypted with `age` for one public key (BACKUP_RECIPIENT, "age1..."). The private key that can
//   open them is only in the owner's password manager, never on a server or in GitHub.
// - Files in PlantOps are written once and never changed or deleted, so a run only copies the files that are not in
//   the backup bucket yet: backup key = "files/<module>/<storage key>.age". Nothing in the bucket is ever removed.
// - Called by the backup job (POST /api/cron/backup, .github/workflows/backup.yml) with the CRON_SECRET header.
// The database is backed up separately by the same workflow (pg_dump), into "db/" in the same bucket.
import { timingSafeEqual } from "node:crypto";
import { Decrypter, Encrypter } from "age-encryption";
import { s3Client, type S3Client, type S3Settings } from "./s3";

export type BackupSettings = S3Settings & { recipient: string };

/** Where this copy's files can be read from (each module's own storage). */
export interface BackupSource {
  list(): Promise<string[]>;
  get(key: string): Promise<Buffer>;
}

export type BackupResult =
  | { status: "not set up" }
  | { status: "ok" | "failed"; total: number; copied: number; waiting: number; failed: number; error?: string };

/** The backup bucket from BACKUP_* variables; null while BACKUP_BUCKET is unset. Half-set settings are an error. */
export function backupSettings(): BackupSettings | null {
  const e = process.env;
  if (!e.BACKUP_BUCKET) {
    if (e.BACKUP_ACCESS_KEY_ID || e.BACKUP_SECRET_ACCESS_KEY || e.BACKUP_RECIPIENT) throw new Error("Set BACKUP_BUCKET to use the configured backup settings");
    return null;
  }
  const missing = ["BACKUP_ENDPOINT", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY", "BACKUP_RECIPIENT"].filter((n) => !e[n]);
  if (missing.length) throw new Error(`Backup needs ${missing.join(", ")} when BACKUP_BUCKET is set`);
  if (!/^age1[0-9a-z]{58}$/.test(e.BACKUP_RECIPIENT!)) throw new Error("BACKUP_RECIPIENT must be an age public key (age1...)");
  return {
    bucket: e.BACKUP_BUCKET,
    endpoint: e.BACKUP_ENDPOINT!,
    region: e.BACKUP_REGION || "auto",
    accessKey: e.BACKUP_ACCESS_KEY_ID!,
    secretKey: e.BACKUP_SECRET_ACCESS_KEY!,
    recipient: e.BACKUP_RECIPIENT!,
  };
}

export async function encryptBackup(data: Buffer, recipient: string): Promise<Buffer> {
  const e = new Encrypter();
  e.addRecipient(recipient);
  return Buffer.from(await e.encrypt(new Uint8Array(data)));
}

export async function decryptBackup(data: Buffer, identity: string): Promise<Buffer> {
  const d = new Decrypter();
  d.addIdentity(identity);
  return Buffer.from(await d.decrypt(new Uint8Array(data)));
}

export const backupKeyFor = (moduleId: string, key: string) => `files/${moduleId}/${key}.age`;

/**
 * Deletes the backup copy of one file (Job applications' removal after 12 months or "Remove now": the personal data
 * must go from the backup too). "not set up" when there is no backup bucket. Every other module never calls it.
 */
export async function removeBackupCopy(moduleId: string, key: string, opts: { settings?: BackupSettings | null; target?: S3Client } = {}): Promise<"removed" | "not set up"> {
  if (!/^[a-z_]+$/.test(moduleId)) throw new Error("Invalid module id");
  if (key.includes("..") || key.startsWith("/")) throw new Error("Invalid file key");
  const settings = opts.settings === undefined ? backupSettings() : opts.settings;
  if (!settings) return "not set up";
  const target = opts.target ?? s3Client(settings);
  if (!target.delete) throw new Error("This backup bucket client can't delete");
  await target.delete(backupKeyFor(moduleId, key));
  return "removed";
}

/**
 * Copies the files that are not in the backup bucket yet. Stops starting new files after `timeLimitMs`; the rest
 * ("waiting") go on the next run. One unreadable file doesn't stop the others, but makes the run "failed".
 */
export async function backupNewFiles(
  moduleId: string,
  source: BackupSource,
  opts: { settings?: BackupSettings | null; target?: S3Client; timeLimitMs?: number; now?: () => number } = {},
): Promise<BackupResult> {
  if (!/^[a-z_]+$/.test(moduleId)) throw new Error("Invalid module id");
  const settings = opts.settings === undefined ? backupSettings() : opts.settings;
  if (!settings) return { status: "not set up" };
  const target = opts.target ?? s3Client(settings);
  const now = opts.now ?? Date.now;
  const stopAt = now() + (opts.timeLimitMs ?? 60_000);

  const done = new Set(await target.list(`files/${moduleId}/`));
  const todo = (await source.list()).filter((k) => !done.has(backupKeyFor(moduleId, k)));
  let copied = 0;
  let failed = 0;
  let error: string | undefined;
  for (const key of todo) {
    if (now() >= stopAt) break;
    try {
      if (key.includes("..") || key.startsWith("/")) throw new Error(`Odd storage key ${key}`);
      await target.put(backupKeyFor(moduleId, key), await encryptBackup(await source.get(key), settings.recipient), "application/octet-stream");
      copied++;
    } catch (err) {
      failed++;
      error ??= `${key}: ${(err as Error).message}`;
      console.error(`[${moduleId}] backup of ${key} failed:`, (err as Error).message);
    }
  }
  const total = done.size + copied;
  const waiting = todo.length - copied - failed;
  return { status: failed ? "failed" : "ok", total, copied, waiting, failed, ...(error ? { error } : {}) };
}

/** POST /api/cron/backup: CRON_SECRET header required; 500 when the run failed, so the scheduler reports it. */
export async function backupRoute(req: Request, run: () => Promise<BackupResult>): Promise<Response> {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return Response.json({ error: "The backup job is not configured (CRON_SECRET)" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-cron-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "Not allowed" }, { status: 401 });
  try {
    const result = await run();
    return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
  } catch (err) {
    console.error("backup failed:", (err as Error).message);
    return Response.json({ status: "failed", error: (err as Error).message }, { status: 500 });
  }
}
