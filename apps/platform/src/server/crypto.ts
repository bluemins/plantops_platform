import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/** URL-safe random string, used for session ids, handoff codes and module secrets. */
export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

/** Session ids, handoff codes and module secrets are high-entropy, so a plain SHA-256 is enough to store them. */
export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PINs and passwords are low-entropy, so they get a slow argon2id hash. */
export function hashSecret(secret: string) {
  return hash(secret);
}

export async function verifySecret(secretHash: string, secret: string) {
  try {
    return await verify(secretHash, secret);
  } catch {
    return false;
  }
}

// Used when the user doesn't exist, so a wrong username takes as long as a wrong PIN.
let dummyHash: Promise<string> | undefined;
export async function burnTime(secret: string) {
  dummyHash ??= hash("not-a-real-secret");
  await verifySecret(await dummyHash, secret);
}

export type SecretKind = "pin" | "password";

/** Staff use a 6-digit PIN; tenant_admins and super_admins use a password of at least 10 characters. */
export function validateSecret(kind: SecretKind, secret: string): string | null {
  if (kind === "pin") return /^\d{6}$/.test(secret) ? null : "PIN must be exactly 6 digits";
  return secret.length >= 10 ? null : "Password must be at least 10 characters";
}

/** Temporary secret handed to a user by an admin; they must change it on first login. */
export function temporarySecret(kind: SecretKind) {
  if (kind === "pin") return String(randomInt(0, 1_000_000)).padStart(6, "0");
  return randomBytes(9).toString("base64url"); // 12 characters
}
