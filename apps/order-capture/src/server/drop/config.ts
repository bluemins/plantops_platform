// Drop's settings (docs/CUSTOMER_APP_PHASE_PLAN.md "Login"). Environment only:
//   * DROP_APPS = {"<app id>": {"tenant_id": "<plant id>", "brand": "Bluemins"}}: the app id Drop sends in the
//     `x-drop-app` header → its plant (never from the request itself) and the brand every shop of that plant sees.
//     Brands are data, never code: another plant's app names its own.
//   * DROP_CODE_SECRET (≥ 32 characters) signs the login codes (only an HMAC is stored).
//   * The login-code template is the plant's "login_content_sid" in TWILIO_WHATSAPP_SENDERS (thanks.ts).
// A broken value switches the customer API off (logged, and listed by /health), never half on.
import { z } from "zod";
import { BRAND_MAX } from "@/lib/brand";
import { env } from "../env";

const AppEntry = z.object({ tenant_id: z.uuid(), brand: z.string().trim().min(1).max(BRAND_MAX) }).strict();
const Apps = z.record(z.string().regex(/^[a-z0-9-]{1,30}$/), AppEntry);

export interface DropApp {
  id: string;
  tenantId: string;
  /** the brand every shop of this plant sees (others are ticked per shop) */
  brand: string;
}

export const SECRET_MIN = 32;

let parsedFrom: string | null = null;
let parsed: DropApp[] = [];
let problem: string | null = null;

function read() {
  const raw = env.dropApps;
  if (raw === parsedFrom) return;
  parsedFrom = raw;
  parsed = [];
  problem = null;
  if (!raw.trim()) return;
  try {
    parsed = Object.entries(Apps.parse(JSON.parse(raw))).map(([id, e]) => ({ id, tenantId: e.tenant_id, brand: e.brand }));
  } catch (err) {
    problem = 'DROP_APPS is not valid (it must look like {"drop": {"tenant_id": "…", "brand": "…"}}), so the Drop app is off';
    console.error(`[order-capture] ${problem}:`, (err as Error).message);
  }
}

/** Every configured app; [] when DROP_APPS is empty or broken, or the code secret is missing. */
export function dropApps(): DropApp[] {
  read();
  return env.dropCodeSecret.length >= SECRET_MIN ? parsed : [];
}

/** The app with this id, or null (unknown app, or the customer API is off). */
export const dropApp = (id: string | null | undefined) => (id ? (dropApps().find((a) => a.id === id) ?? null) : null);

/** The plant's Drop app (its main brand), or null when this plant has none. */
export const dropAppOfPlant = (tenantId: string) => dropApps().find((a) => a.tenantId === tenantId) ?? null;

/** What is wrong with Drop's settings (for /health); null = fine or not set up. */
export function dropSettingsProblem(): string | null {
  read();
  if (problem) return problem;
  if (parsed.length > 0 && env.dropCodeSecret.length < SECRET_MIN) return `DROP_CODE_SECRET is missing or shorter than ${SECRET_MIN} characters, so the Drop app is off`;
  return null;
}
