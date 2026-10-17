// What the public form accepts: shared by the form (checks before sending) and the server (checks again).
// docs/JOB_APPLICATIONS_PHASE_PLAN.md "Public page" / "Sending an application".

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // one PDF, or each photo
export const MAX_PHOTOS = 3;
/** The whole send (3 photos + the fields), checked before the server reads the body. */
export const MAX_BODY_BYTES = 12 * 1024 * 1024;
export const LIMITS = { name: [2, 100], place: [2, 200] } as const;

/** The consent text the applicant ticks; its version is stored with every application. Change the text = new version. */
export const CONSENT_VERSION = "v1";
export const consentText = (plant: string) => `I agree that ${plant} may keep my details for 12 months to contact me about jobs.`;

/** A one-time key for one filled-in form (a double tap sends the same one). Not crypto.randomUUID(): that only exists
 * on https pages, and phones test on plain http (pnpm dev:lan). */
export function newRequestKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `a${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const formatRef = (n: number) => `J-${String(n).padStart(4, "0")}`;
