// Prints a new Ed25519 private key (JWK, base64-encoded) for signing SSO tokens.
// Usage: node scripts/generate-sso-key.mjs  -> put the output in SSO_PRIVATE_JWK_B64.
import { generateKeyPairSync, randomUUID } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const jwk = { ...privateKey.export({ format: "jwk" }), kid: randomUUID(), alg: "EdDSA", use: "sig" };
process.stdout.write(Buffer.from(JSON.stringify(jwk)).toString("base64"));
