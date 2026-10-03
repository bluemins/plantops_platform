import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit, type Actor } from "./audit";
import { schema, superDb, withTenant, type PlatformTx } from "./db";
import { badRequest, conflict, notFound } from "./http";
import type { CurrentUser } from "./auth";
import type { CurrentSuperAdmin } from "./super-auth";

const { tenants, tenantProfiles, tenantSkus } = schema;

export const MAX_LOGO_BYTES = 300 * 1024;
export const PACK_TYPES = ["bottle", "jar", "pouch", "cup", "case", "other"] as const;

/** Optional text field: blank means "not set" (null). */
const optional = <T extends z.ZodType>(inner: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), inner.nullable());

const Logo = z.object({ data_base64: z.string().max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 4) });

/** Everything except the plant name: what super_admin can also fill in when creating a plant. */
export const ProfileInput = z
  .object({
    brand_color: optional(z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Brand color: pick a color like #1d4ed8")),
    description: optional(z.string().trim().max(500)),
    address: optional(z.string().trim().max(200)),
    city: optional(z.string().trim().max(80)),
    state: optional(z.string().trim().max(80)),
    pincode: optional(z.string().trim().regex(/^\d{6}$/, "PIN code: 6 digits")),
    phone: optional(z.string().trim().regex(/^\+?[0-9][0-9 -]{6,18}$/, "Phone: digits only, e.g. +91 98765 43210")),
    logo: Logo.nullable(), // null removes the logo; leave out to keep it
  })
  .partial();
export type ProfileInput = z.infer<typeof ProfileInput>;

export const BusinessInput = ProfileInput.extend({ name: z.string().trim().min(1).max(120) }).partial();
export type BusinessInput = z.infer<typeof BusinessInput>;

export const SkuInput = z.object({
  name: z.string().trim().min(1).max(80),
  sku_code: optional(z.string().trim().toUpperCase().regex(/^[A-Z0-9._/-]{1,40}$/, "SKU code: letters, digits, . _ / -")).optional(),
  volume_ml: z.number().int().min(1).max(100000), // size of one unit (one bottle/jar)
  units_per_pack: z.number().int().min(1).max(1000).default(1), // e.g. 24 for a case of 24 bottles
  pack_type: z.enum(PACK_TYPES),
});
// No defaults when editing: a field that isn't sent stays as it is.
export const UpdateSkuInput = SkuInput.extend({
  units_per_pack: z.number().int().min(1).max(1000),
  status: z.enum(["active", "inactive"]),
}).partial();

/** Checks the file really is a PNG, JPEG or WebP (by its first bytes, not by what the browser claims). */
export function decodeLogo(base64: string): { data: Buffer; type: string } {
  const data = Buffer.from(base64, "base64");
  if (data.length === 0) throw badRequest("Logo file is empty");
  if (data.length > MAX_LOGO_BYTES) throw badRequest("Logo is too big (max 300 KB)");
  const head = data.subarray(0, 12);
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { data, type: "image/png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { data, type: "image/jpeg" };
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") {
    return { data, type: "image/webp" };
  }
  throw badRequest("Logo must be a PNG, JPG or WebP image");
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ---------- shared logic (caller picks the login: platform_app via withTenant, or platform_super) ----------

async function readBusiness(tx: PlatformTx, tenantId: string, logoPath: string) {
  const [row] = await tx
    .select({
      name: tenants.name,
      code: tenants.code,
      logoUpdatedAt: tenantProfiles.logoUpdatedAt,
      brandColor: tenantProfiles.brandColor,
      description: tenantProfiles.description,
      address: tenantProfiles.address,
      city: tenantProfiles.city,
      state: tenantProfiles.state,
      pincode: tenantProfiles.pincode,
      phone: tenantProfiles.phone,
    })
    .from(tenants)
    .leftJoin(tenantProfiles, eq(tenantProfiles.tenantId, tenants.id))
    .where(eq(tenants.id, tenantId));
  if (!row) throw notFound("Plant not found");
  return {
    name: row.name,
    code: row.code,
    // ?v= changes whenever the logo changes, so browsers never show a stale cached copy.
    logo_url: row.logoUpdatedAt ? `${logoPath}?v=${row.logoUpdatedAt.getTime()}` : null,
    brand_color: row.brandColor,
    description: row.description,
    address: row.address,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    phone: row.phone,
  };
}

/** Saves the profile fields that were sent (others stay as they are). Creates the row on first save. */
export async function writeProfile(tx: PlatformTx, tenantId: string, input: ProfileInput, actor: Actor) {
  const { logo, ...fields } = input;
  const changes: Partial<typeof tenantProfiles.$inferInsert> = {};
  if (fields.brand_color !== undefined) changes.brandColor = fields.brand_color;
  if (fields.description !== undefined) changes.description = fields.description;
  if (fields.address !== undefined) changes.address = fields.address;
  if (fields.city !== undefined) changes.city = fields.city;
  if (fields.state !== undefined) changes.state = fields.state;
  if (fields.pincode !== undefined) changes.pincode = fields.pincode;
  if (fields.phone !== undefined) changes.phone = fields.phone;
  if (logo === null) Object.assign(changes, { logo: null, logoType: null, logoUpdatedAt: null });
  if (logo) {
    const decoded = decodeLogo(logo.data_base64);
    Object.assign(changes, { logo: decoded.data, logoType: decoded.type, logoUpdatedAt: new Date() });
  }
  if (!Object.keys(changes).length) return;
  const values = { ...changes, updatedAt: new Date(), updatedBy: actor };
  await tx.insert(tenantProfiles).values({ tenantId, ...values }).onConflictDoUpdate({ target: tenantProfiles.tenantId, set: values });
  // The audit log records what changed, never the image itself.
  const details: Record<string, unknown> = { ...fields };
  if (logo !== undefined) details.logo = logo === null ? "removed" : "changed";
  await audit(tx, { tenantId, actor, action: "tenant.profile_updated", target: tenantId, details });
}

async function writeBusiness(tx: PlatformTx, tenantId: string, input: BusinessInput, actor: Actor) {
  const { name, ...profile } = input;
  if (name !== undefined) {
    await tx.update(tenants).set({ name, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    await audit(tx, { tenantId, actor, action: "tenant.renamed", target: tenantId, details: { name } });
  }
  await writeProfile(tx, tenantId, profile, actor);
}

async function readLogo(tx: PlatformTx, tenantId: string) {
  const [row] = await tx
    .select({ logo: tenantProfiles.logo, type: tenantProfiles.logoType })
    .from(tenantProfiles)
    .where(eq(tenantProfiles.tenantId, tenantId));
  if (!row?.logo || !row.type) throw notFound("No logo");
  return { data: row.logo, type: row.type };
}

function skuView(s: typeof tenantSkus.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    sku_code: s.skuCode,
    volume_ml: s.volumeMl,
    units_per_pack: s.unitsPerPack,
    pack_type: s.packType,
    status: s.status,
  };
}

async function listSkusTx(tx: PlatformTx, tenantId: string) {
  const rows = await tx.select().from(tenantSkus).where(eq(tenantSkus.tenantId, tenantId)).orderBy(asc(tenantSkus.name));
  return rows.map(skuView);
}

const duplicateSku = (code: string | null | undefined) => conflict(`SKU code ${code} is already used in this plant`);

async function addSku(tx: PlatformTx, tenantId: string, input: z.infer<typeof SkuInput>, actor: Actor) {
  try {
    const [row] = await tx
      .insert(tenantSkus)
      .values({
        tenantId,
        name: input.name,
        skuCode: input.sku_code ?? null,
        volumeMl: input.volume_ml,
        unitsPerPack: input.units_per_pack,
        packType: input.pack_type,
        createdBy: actor,
      })
      .returning();
    await audit(tx, { tenantId, actor, action: "sku.created", target: row!.id, details: input });
    return skuView(row!);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateSku(input.sku_code);
    throw err;
  }
}

async function editSku(tx: PlatformTx, tenantId: string, skuId: string, input: z.infer<typeof UpdateSkuInput>, actor: Actor) {
  const changes: Partial<typeof tenantSkus.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.sku_code !== undefined) changes.skuCode = input.sku_code;
  if (input.volume_ml !== undefined) changes.volumeMl = input.volume_ml;
  if (input.units_per_pack !== undefined) changes.unitsPerPack = input.units_per_pack;
  if (input.pack_type !== undefined) changes.packType = input.pack_type;
  if (input.status !== undefined) changes.status = input.status;
  try {
    const [row] = await tx
      .update(tenantSkus)
      .set(changes)
      .where(and(eq(tenantSkus.tenantId, tenantId), eq(tenantSkus.id, skuId)))
      .returning();
    if (!row) throw notFound("Product not found");
    await audit(tx, { tenantId, actor, action: "sku.updated", target: skuId, details: input });
    return skuView(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicateSku(input.sku_code);
    throw err;
  }
}

// ---------- plant owner (platform_app login, row-level security on) ----------

const ownerLogo = "/api/business/logo";
const userActor = (u: CurrentUser) => `user:${u.userId}` as const;

export const getBusiness = (admin: CurrentUser) => withTenant(admin.tenantId, (tx) => readBusiness(tx, admin.tenantId, ownerLogo));

export const updateBusiness = (admin: CurrentUser, input: BusinessInput) =>
  withTenant(admin.tenantId, async (tx) => {
    await writeBusiness(tx, admin.tenantId, input, userActor(admin));
    return readBusiness(tx, admin.tenantId, ownerLogo);
  });

/** Any logged-in user of the plant may see its logo (screens show it). */
export const getOwnLogo = (user: CurrentUser) => withTenant(user.tenantId, (tx) => readLogo(tx, user.tenantId));

export const listSkus = (admin: CurrentUser) => withTenant(admin.tenantId, (tx) => listSkusTx(tx, admin.tenantId));
export const createSku = (admin: CurrentUser, input: z.infer<typeof SkuInput>) =>
  withTenant(admin.tenantId, (tx) => addSku(tx, admin.tenantId, input, userActor(admin)));
export const updateSku = (admin: CurrentUser, skuId: string, input: z.infer<typeof UpdateSkuInput>) =>
  withTenant(admin.tenantId, (tx) => editSku(tx, admin.tenantId, skuId, input, userActor(admin)));

// ---------- super_admin (platform_super login; caller has passed requireSuperAdmin) ----------

const superLogo = (tenantId: string) => `/api/super/tenants/${tenantId}/logo`;
const superActor = (a: CurrentSuperAdmin) => `super_admin:${a.id}` as const;

export const superGetBusiness = (tenantId: string) => superDb().transaction((tx) => readBusiness(tx, tenantId, superLogo(tenantId)));

export const superUpdateBusiness = (admin: CurrentSuperAdmin, tenantId: string, input: BusinessInput) =>
  superDb().transaction(async (tx) => {
    await readBusiness(tx, tenantId, ""); // 404 for an unknown plant
    await writeBusiness(tx, tenantId, input, superActor(admin));
    return readBusiness(tx, tenantId, superLogo(tenantId));
  });

export const superGetLogo = (tenantId: string) => superDb().transaction((tx) => readLogo(tx, tenantId));

export const superListSkus = (tenantId: string) => superDb().transaction((tx) => listSkusTx(tx, tenantId));
export const superCreateSku = (admin: CurrentSuperAdmin, tenantId: string, input: z.infer<typeof SkuInput>) =>
  superDb().transaction(async (tx) => {
    await readBusiness(tx, tenantId, "");
    return addSku(tx, tenantId, input, superActor(admin));
  });
export const superUpdateSku = (admin: CurrentSuperAdmin, tenantId: string, skuId: string, input: z.infer<typeof UpdateSkuInput>) =>
  superDb().transaction((tx) => editSku(tx, tenantId, skuId, input, superActor(admin)));

// ---------- modules (server-to-server; read through RLS on the app login) ----------

/** Name, brand color and logo link a module uses to brand its screens. The SSO token never carries these. */
export const getBranding = (tenantId: string) =>
  withTenant(tenantId, async (tx) => {
    const b = await readBusiness(tx, tenantId, `/api/m/tenants/${tenantId}/logo`);
    return { tenant_id: tenantId, name: b.name, brand_color: b.brand_color, logo_url: b.logo_url };
  });

export const getLogoForModule = (tenantId: string) => withTenant(tenantId, (tx) => readLogo(tx, tenantId));

/** Sends a stored logo as an image. Locked down so the browser only ever treats it as a picture. */
export function logoResponse(logo: { data: Buffer; type: string }) {
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "content-type": logo.type,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
