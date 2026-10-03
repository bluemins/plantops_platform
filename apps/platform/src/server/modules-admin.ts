// super_admin "Modules" screen: where each module app lives, its client secret, and the global on/off switch.
// A brand-new module still starts as code (id + role in packages/types, a migration, the app itself).
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MODULE_IDS, type ModuleId } from "@plantops/types";
import { audit } from "./audit";
import { randomToken, sha256 } from "./crypto";
import { schema, superDb } from "./db";
import { notFound } from "./http";
import type { CurrentSuperAdmin } from "./super-auth";

const { modules } = schema;

/** A module's address: http(s) origin only (no path, query or login details), e.g. https://lab.plantops.in */
export const ModuleUrl = z
  .string()
  .trim()
  .transform((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Module URL: enter a full address like https://lab.example.com" });
      return z.NEVER;
    }
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
      ctx.addIssue({ code: "custom", message: "Module URL: only http(s)://host[:port], no path or extras" });
      return z.NEVER;
    }
    return u.origin;
  });

export const UpdateModuleInput = z.object({ base_url: ModuleUrl.nullable(), status: z.enum(["active", "disabled"]) }).partial();

function view(m: typeof modules.$inferSelect) {
  return {
    id: m.id as ModuleId,
    name: m.name,
    base_url: m.baseUrl,
    secret_set: !!m.clientSecretHash,
    status: m.status as "active" | "disabled",
    ready: m.status === "active" && !!m.baseUrl && !!m.clientSecretHash,
  };
}

export async function listModules() {
  const rows = await superDb().select().from(modules);
  return MODULE_IDS.flatMap((id) => rows.filter((r) => r.id === id).map(view));
}

const actorOf = (a: CurrentSuperAdmin) => `super_admin:${a.id}` as const;

/** Change URL and/or switch the module on/off for every plant (plans keep their settings). */
export async function updateModule(admin: CurrentSuperAdmin, id: ModuleId, input: z.infer<typeof UpdateModuleInput>) {
  return superDb().transaction(async (tx) => {
    const changes: Partial<typeof modules.$inferInsert> = {};
    if (input.base_url !== undefined) changes.baseUrl = input.base_url;
    if (input.status !== undefined) changes.status = input.status;
    const [row] = Object.keys(changes).length
      ? await tx.update(modules).set(changes).where(eq(modules.id, id)).returning()
      : await tx.select().from(modules).where(eq(modules.id, id));
    if (!row) throw notFound("Module not found");
    await audit(tx, { tenantId: null, actor: actorOf(admin), action: "module.updated", target: id, details: input });
    return view(row);
  });
}

/** New client secret, shown once. The old one stops working immediately. Only its hash is stored. */
export async function newModuleSecret(admin: CurrentSuperAdmin, id: ModuleId) {
  const secret = randomToken(32);
  return superDb().transaction(async (tx) => {
    const [row] = await tx.update(modules).set({ clientSecretHash: sha256(secret) }).where(eq(modules.id, id)).returning();
    if (!row) throw notFound("Module not found");
    await audit(tx, { tenantId: null, actor: actorOf(admin), action: "module.secret_rotated", target: id });
    return { module: view(row), client_secret: secret };
  });
}
