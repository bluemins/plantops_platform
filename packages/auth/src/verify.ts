import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";
import { TOKEN_ISSUER, TokenPayload, type ModuleId } from "@plantops/types";

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/** Key source for verification: the platform's JWKS URL (production) or an in-memory key set (tests). */
export type KeySource = { jwksUrl: string } | { jwks: JSONWebKeySet };

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

function keyGetter(source: KeySource): JWTVerifyGetKey {
  if ("jwks" in source) return createLocalJWKSet(source.jwks);
  let getter = remoteKeySets.get(source.jwksUrl);
  if (!getter) {
    // jose caches the fetched keys and refetches when it sees an unknown `kid` (key rotation).
    getter = createRemoteJWKSet(new URL(source.jwksUrl), { cacheMaxAge: 10 * 60 * 1000 });
    remoteKeySets.set(source.jwksUrl, getter);
  }
  return getter;
}

/**
 * Verifies an SSO token for one module. Rejects anything not signed by the platform's EdDSA key, expired,
 * issued for a different module, or with an unexpected payload shape. Throws InvalidTokenError.
 */
export async function verifyToken(token: string, opts: { audience: ModuleId; keys: KeySource }) {
  try {
    const { payload } = await jwtVerify(token, keyGetter(opts.keys), {
      algorithms: ["EdDSA"],
      issuer: TOKEN_ISSUER,
      audience: opts.audience,
      requiredClaims: ["exp", "iat", "jti"],
    });
    const parsed = TokenPayload.safeParse(payload);
    if (!parsed.success) throw new InvalidTokenError("Token payload has an unexpected shape");
    return parsed.data;
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    throw new InvalidTokenError(err instanceof Error ? err.message : "Invalid token");
  }
}
