import { afterAll } from "vitest";
import { closeDb } from "@/server/db";
import { loadTestEnv } from "./load-test-env";

loadTestEnv();
afterAll(() => closeDb());
