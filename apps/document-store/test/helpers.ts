import { randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import type { RoleId } from "@plantops/types";
import { docDb } from "@/server/db";
import { toDocUser, type DocUser } from "@/server/session";
import { KEEPER_ID, OWNER_ID } from "./fake-platform";

/** A Document Store user of one plant, as the session would describe them. */
export function docUser(tenantId: string, roles: RoleId[], name = roles.join("+"), userId = randomUUID()): DocUser {
  const now = Date.now();
  return toDocUser({ tenant_id: tenantId, user_id: userId, display_name: name, roles, enabled_modules: ["document_store"], login_at: now, checked_at: now });
}

/** A fresh plant id with the owner and keeper the fake platform knows, plus a store keeper. */
export function plant() {
  const tenantId = randomUUID();
  return {
    tenantId,
    owner: docUser(tenantId, ["tenant_admin"], "Sujata", OWNER_ID),
    keeper: docUser(tenantId, ["document_keeper"], "Priya", KEEPER_ID),
    storeKeeper: docUser(tenantId, ["store_keeper"], "Sunil"),
  };
}

export async function asOwner<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL_OWNER });
  await c.connect();
  try {
    return await c.query<T>(text, values);
  } finally {
    await c.end();
  }
}

/** Raw SQL as the app's own login (doc_app) inside one plant - what the app itself is allowed to do. */
export async function asApp(tenantId: string, text: string) {
  return docDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return tx.execute(sql.raw(text));
  });
}

export async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return e.cause?.message ?? e.message;
  }
  throw new Error("Expected the database to refuse this, but it succeeded");
}

export async function refused(fn: () => Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await fn();
  } catch (err) {
    const e = err as Error & { status?: number };
    return { status: e.status ?? 0, message: e.message };
  }
  throw new Error("Expected this to be refused, but it succeeded");
}

/** Small real-looking files: the first bytes are what the type check reads. */
export const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), Buffer.from("JFIF stub")]);
export const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 stub")]);

/** "YYYY-MM-DD" n days from today (India). */
export const inDays = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + n * 86_400_000));
