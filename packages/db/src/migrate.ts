import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

/**
 * Applies `*.sql` files from `dir` in name order, once each, recording them in `<schema>.schema_migrations`.
 * Run with the owner login only. Each file runs in its own transaction. Migrations must stay
 * backward-compatible (CLAUDE.md) - never edit a file that has already been applied; add a new one.
 */
export async function migrate(ownerUrl: string, schema: string, dir: string, log = console.log) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query(`create schema if not exists ${pg.escapeIdentifier(schema)}`);
    const table = `${pg.escapeIdentifier(schema)}.schema_migrations`;
    await client.query(`create table if not exists ${table} (name text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query(`select name from ${table}`)).rows.map((r) => r.name as string));
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const body = await readFile(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(body);
        await client.query(`insert into ${table} (name) values ($1)`, [file]);
        await client.query("commit");
        log(`applied ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}
