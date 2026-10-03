// Recovery: set a super_admin's password from the terminal (e.g. forgotten password).
// Usage: pnpm super:set-password [email]   (defaults to SUPER_ADMIN_EMAIL). The password is typed, not echoed.
import { stdin, stdout } from "node:process";
import pg from "pg";
import { hashSecret, validateSecret } from "../src/server/crypto";
import { requireEnv } from "./load-env";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(question);
    let value = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.off("data", onData);
        stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(1); // Ctrl+C
      } else if (ch === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Ignore the "--" separator some package managers pass through.
const emailArg = process.argv.slice(2).find((a) => a !== "--");
const email = (emailArg ?? requireEnv("SUPER_ADMIN_EMAIL")).trim().toLowerCase();
if (!stdin.isTTY) throw new Error("Run this in a terminal - it needs to read the password from the keyboard.");
const password = await askHidden(`New password for ${email}: `);
const problem = validateSecret("password", password);
if (problem) throw new Error(problem);
if ((await askHidden("Repeat it: ")) !== password) throw new Error("The two passwords don't match");

const client = new pg.Client({ connectionString: requireEnv("DATABASE_URL_OWNER") });
await client.connect();
try {
  await client.query("begin");
  const res = await client.query(
    "update platform.super_admins set password_hash = $2, failed_attempts = 0, locked_until = null where email = $1 returning id",
    [email, await hashSecret(password)],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`No super_admin with email ${email}`);
  await client.query("update platform.super_admin_sessions set revoked_at = now() where super_admin_id = $1 and revoked_at is null", [id]);
  await client.query(
    "insert into platform.audit_log (tenant_id, actor, action, target) values (null, 'system', 'super_admin.password_set_from_terminal', $1)",
    [id],
  );
  await client.query("commit");
  console.log(`Password updated for ${email}. All their sessions were logged out.`);
} catch (err) {
  await client.query("rollback");
  throw err;
} finally {
  await client.end();
}
