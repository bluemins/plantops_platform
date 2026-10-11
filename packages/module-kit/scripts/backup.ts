// pnpm backup <command> - looks into and restores from the encrypted backups (docs/HANDBOOK.md "Backups").
//   list                          what is in the bucket: database dumps by date, file count per module
//   db [YYYY-MM-DD] <out-file>    download + decrypt one database dump (newest when no date is given)
//   files <module> <out-dir>      download + decrypt every backed-up file of a module (e.g. document_store)
//   decrypt <in.age> <out-file>   decrypt a file downloaded by hand from the Cloudflare dashboard
// Bucket settings (BACKUP_BUCKET, BACKUP_ENDPOINT, BACKUP_ACCESS_KEY_ID, BACKUP_SECRET_ACCESS_KEY) come from
// BACKUP_ENV_FILE (default .env.railway.shared in the repo). The private key is asked for (hidden), or taken from
// BACKUP_IDENTITY. Nothing is uploaded or deleted: this tool only reads the bucket.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { decryptBackup } from "../src/backup";
import { s3Client } from "../src/s3";

const repo = path.resolve(import.meta.dirname, "../../..");
const cwd = process.env.INIT_CWD ?? process.cwd(); // pnpm runs this inside packages/module-kit
const out = (p: string) => path.resolve(cwd, p);

function settings() {
  const file = process.env.BACKUP_ENV_FILE ? out(process.env.BACKUP_ENV_FILE) : path.join(repo, ".env.railway.shared");
  if (!existsSync(file)) throw new Error(`${file} not found - restore it from your password manager first`);
  const vars = Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim()))
      .filter((m) => m !== null)
      .map((m) => [m[1]!, m[2]!]),
  );
  const missing = ["BACKUP_BUCKET", "BACKUP_ENDPOINT", "BACKUP_ACCESS_KEY_ID", "BACKUP_SECRET_ACCESS_KEY"].filter((n) => !vars[n]);
  if (missing.length) throw new Error(`${file} needs ${missing.join(", ")} (docs/HANDBOOK.md "Backups")`);
  return s3Client({ bucket: vars.BACKUP_BUCKET!, endpoint: vars.BACKUP_ENDPOINT!, region: vars.BACKUP_REGION || "auto", accessKey: vars.BACKUP_ACCESS_KEY_ID!, secretKey: vars.BACKUP_SECRET_ACCESS_KEY! });
}

async function privateKey(): Promise<string> {
  if (process.env.BACKUP_IDENTITY) return process.env.BACKUP_IDENTITY.trim();
  let muted = false;
  const silent = new Writable({ write: (chunk, _enc, cb) => (muted || process.stdout.write(chunk), cb()) });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
  const answer = await new Promise<string>((resolve) => {
    rl.question("Private backup key (AGE-SECRET-KEY-..., input hidden): ", resolve);
    muted = true;
  });
  rl.close();
  process.stdout.write("\n");
  if (!answer.trim().startsWith("AGE-SECRET-KEY-")) throw new Error("That is not an age private key (AGE-SECRET-KEY-...)");
  return answer.trim();
}

const [command, ...args] = process.argv.slice(2);
const usage = "Usage: pnpm backup list | db [YYYY-MM-DD] <out-file> | files <module> <out-dir> | decrypt <in.age> <out-file>";

try {
  if (command === "list") {
    const s3 = settings();
    const dumps = (await s3.list("db/")).sort();
    console.log(`Database dumps (${dumps.length}):`);
    for (const d of dumps) console.log(`  ${d}`);
    const files = await s3.list("files/");
    const perModule = new Map<string, number>();
    for (const f of files) perModule.set(f.split("/")[1]!, (perModule.get(f.split("/")[1]!) ?? 0) + 1);
    console.log("Files:");
    for (const [m, n] of perModule) console.log(`  ${m}: ${n}`);
    if (!perModule.size) console.log("  (none yet)");
  } else if (command === "db") {
    const [date, target] = args.length === 2 ? args : [undefined, args[0]];
    if (!target || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw new Error(usage);
    const s3 = settings();
    const dumps = (await s3.list("db/")).filter((k) => !date || k.includes(`-${date}.`)).sort();
    const key = dumps.at(-1);
    if (!key) throw new Error(date ? `No database dump for ${date}` : "No database dumps in the bucket yet");
    const identity = await privateKey();
    writeFileSync(out(target), await decryptBackup(await s3.get(key), identity), { mode: 0o600 });
    console.log(`${key} -> ${out(target)}  (restore it with pg_restore, docs/HANDBOOK.md "Backups")`);
  } else if (command === "files") {
    const [moduleId, dir] = args;
    if (!moduleId || !/^[a-z_]+$/.test(moduleId) || !dir) throw new Error(usage);
    const s3 = settings();
    const prefix = `files/${moduleId}/`;
    const keys = await s3.list(prefix);
    if (!keys.length) throw new Error(`No backed-up files for ${moduleId}`);
    const identity = await privateKey();
    let written = 0;
    for (const key of keys) {
      const rel = key.slice(prefix.length).replace(/\.age$/, "");
      if (rel.includes("..")) throw new Error(`Odd key in bucket: ${key}`);
      const file = path.join(out(dir), rel);
      if (existsSync(file)) continue;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, await decryptBackup(await s3.get(key), identity), { mode: 0o600 });
      written++;
    }
    console.log(`${written} of ${keys.length} files written to ${out(dir)} (files already there were skipped)`);
  } else if (command === "decrypt") {
    const [input, target] = args;
    if (!input || !target) throw new Error(usage);
    const identity = await privateKey();
    writeFileSync(out(target), await decryptBackup(readFileSync(out(input)), identity), { mode: 0o600 });
    console.log(`-> ${out(target)}`);
  } else {
    throw new Error(usage);
  }
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
