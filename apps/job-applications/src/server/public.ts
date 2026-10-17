// Which plant a public job page belongs to (docs/JOB_APPLICATIONS_PHASE_PLAN.md "Which plant a public page belongs
// to"). The plant comes ONLY from the address: the bare address = JOBS_DEFAULT_PLANT, /<code> = that plant, looked up
// on the platform (active and with Job applications switched on). Never from anything the browser sends.
import { env } from "./env";
import { kit } from "./kit";

export interface PublicPlantView {
  tenantId: string;
  name: string;
  /** the plant code as used in links (upper case) */
  code: string;
  /** true when this plant is at the bare address (links leave the code out) */
  isDefault: boolean;
  brandColor: string | null;
  hasLogo: boolean;
}

const CODE = /^[A-Za-z0-9_-]{3,32}$/;

/** The platform couldn't be asked: the page says "try again later", never "not available". */
export class PlatformUnavailable extends Error {}

/** null = "This page is not available" (one answer for every reason). */
export async function resolvePublicPlant(code: string | null): Promise<PublicPlantView | null> {
  const wanted = (code ?? env.defaultPlant).toUpperCase();
  if (!CODE.test(wanted)) return null;
  let plant;
  try {
    plant = await kit.plantByCode(wanted);
  } catch {
    throw new PlatformUnavailable("PlantOps can't be reached right now");
  }
  if (!plant) return null;
  const b = await kit.branding(plant.tenant_id);
  return {
    tenantId: plant.tenant_id,
    name: plant.name,
    code: wanted,
    isDefault: Boolean(env.defaultPlant) && wanted === env.defaultPlant,
    brandColor: b?.brand_color ?? null,
    hasLogo: Boolean(b?.logo_url),
  };
}

/** The start of every link on this plant's public pages: "" for the bare address, "/<code>" otherwise. */
export const basePath = (p: Pick<PublicPlantView, "code" | "isDefault">) => (p.isDefault ? "" : `/${p.code}`);

/** The address the owner shares and prints: this app's public address (or the one it was opened on) + the plant's path. */
export function publicLink(origin: string, p: Pick<PublicPlantView, "code" | "isDefault">) {
  return `${env.publicUrl || origin}${basePath(p)}` || "/";
}
