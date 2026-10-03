// Creates the first super_admin and registers module URLs/secrets from environment variables.
// Safe to run repeatedly. Usage: pnpm db:seed
import pg from "pg";
import { MODULE_IDS } from "@plantops/types";
import { hashSecret, sha256 } from "../src/server/crypto";
import { requireEnv } from "./load-env";

const client = new pg.Client({ connectionString: requireEnv("DATABASE_URL_OWNER") });
await client.connect();
try {
  const email = requireEnv("SUPER_ADMIN_EMAIL").trim().toLowerCase();
  const existing = await client.query("select 1 from platform.super_admins where email = $1", [email]);
  if (existing.rowCount === 0) {
    const password = requireEnv("SUPER_ADMIN_PASSWORD");
    if (password.length < 10) throw new Error("SUPER_ADMIN_PASSWORD must be at least 10 characters");
    await client.query("insert into platform.super_admins (email, name, password_hash) values ($1, $2, $3)", [
      email,
      "PlantOps admin",
      await hashSecret(password),
    ]);
    console.log(`Created super_admin ${email}`);
  } else {
    console.log(`super_admin ${email} already exists`);
  }

  for (const id of MODULE_IDS) {
    const key = id.toUpperCase();
    const url = process.env[`MODULE_URL_${key}`];
    const secret = process.env[`MODULE_SECRET_${key}`];
    if (url) await client.query("update platform.modules set base_url = $2 where id = $1", [id, url]);
    if (secret) await client.query("update platform.modules set client_secret_hash = $2 where id = $1", [id, sha256(secret)]);
    if (url || secret) console.log(`Registered module ${id}`);
  }
} finally {
  await client.end();
}
