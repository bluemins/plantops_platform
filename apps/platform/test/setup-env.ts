import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeEach } from "vitest";
import { closeDbs } from "@/server/db";
import { resetRateLimits } from "@/server/http";
import { loadTestEnv } from "./load-test-env";

loadTestEnv();
// Tests sign with their own throwaway key, never the dev key.
const { privateKey } = generateKeyPairSync("ed25519");
const jwk = { ...privateKey.export({ format: "jwk" }), kid: randomUUID(), alg: "EdDSA" };
process.env.SSO_PRIVATE_JWK_B64 = Buffer.from(JSON.stringify(jwk)).toString("base64");
delete process.env.SSO_PREVIOUS_PUBLIC_JWK_B64;

beforeEach(() => resetRateLimits());
afterAll(() => closeDbs());
