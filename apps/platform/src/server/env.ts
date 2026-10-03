/** Reads required settings lazily, so tests can point them at the test database first. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

export const env = {
  get appDatabaseUrl() {
    return required("DATABASE_URL_APP");
  },
  get superDatabaseUrl() {
    return required("DATABASE_URL_SUPER");
  },
  get platformUrl() {
    return required("PLATFORM_URL");
  },
  get ssoPrivateJwk() {
    return JSON.parse(Buffer.from(required("SSO_PRIVATE_JWK_B64"), "base64").toString("utf8"));
  },
  get ssoPreviousPublicJwk() {
    const raw = process.env.SSO_PREVIOUS_PUBLIC_JWK_B64;
    return raw ? JSON.parse(Buffer.from(raw, "base64").toString("utf8")) : null;
  },
  get secureCookies() {
    return this.platformUrl.startsWith("https://");
  },
};
