import path from "node:path";
import pg from "pg";
import { migrate } from "@plantops/db";
import { loadTestEnv } from "./load-test-env";

/** Once per test run: wipe the document_store schema in the test database and rebuild it from the migrations. */
export default async function setup() {
  loadTestEnv();
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await client.connect();
  await client.query("drop schema if exists document_store cascade");
  await client.end();
  await migrate(process.env.DATABASE_URL_OWNER!, "document_store", path.resolve(import.meta.dirname, "../db/migrations"), () => {});
}
