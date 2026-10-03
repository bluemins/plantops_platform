import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** Points the module at the *test* database and a throwaway file folder. Tests never touch dev data. */
export function loadTestEnv() {
  const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const missing = ["TEST_DATABASE_URL_OWNER", "TEST_DOC_DATABASE_URL_APP"].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing ${missing.join(", ")}. Run ./scripts/setup-module-db.sh document_store doc_app DOC 3003 once.`);
  process.env.DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER;
  process.env.DOC_DATABASE_URL_APP = process.env.TEST_DOC_DATABASE_URL_APP;
  process.env.MODULE_SECRET_DOCUMENT_STORE = "doc-module-test-secret";
  process.env.DOC_SESSION_SECRET = "document-store-test-session-secret-0123456789";
  process.env.DOC_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "plantops-docs-test-"));
  for (const k of ["MODULE_URL_DOCUMENT_STORE", "STORAGE_BUCKET", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"]) delete process.env[k];
}
