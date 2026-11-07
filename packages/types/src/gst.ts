// GST basics shared by the platform (plant GSTIN, product GST rate) and Order Capture (bills, customers' GSTIN, place of
// supply). docs/BILL_FIELDS_PHASE_PLAN.md. Pure functions, no I/O.

/** The GST rates a product can carry (percent). */
export const GST_RATES = [0, 5, 12, 18, 28, 40] as const;
export type GstRate = (typeof GST_RATES)[number];

/** GST state codes (the first two digits of a GSTIN; "place of supply"). */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/** "Odisha (21)", or null for an unknown code. */
export const gstStateLabel = (code: string | null | undefined) => (code && GST_STATES[code] ? `${GST_STATES[code]} (${code})` : null);

const GSTIN_SHAPE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN, worked out from the first 14 (the GSTN check digit, mod 36). */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36]!;
}

/** Upper case, spaces removed: what a person typed, ready to check. */
export const normaliseGstin = (s: string) => s.replace(/\s+/g, "").toUpperCase();

/**
 * Why a GSTIN (already normalised) is not valid, or null when it is: 15 characters in the GSTIN pattern, a known state
 * code and the right check character (catches most typos).
 */
export function gstinProblem(g: string): string | null {
  if (!GSTIN_SHAPE.test(g)) return "GSTIN: 15 characters, like 21AAACL0140P4ZS";
  if (!GST_STATES[g.slice(0, 2)]) return `GSTIN: ${g.slice(0, 2)} is not a GST state code`;
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return "GSTIN: the last character doesn't match (a typo?)";
  return null;
}

/** The state code of a valid GSTIN ("21" for Odisha). */
export const gstinState = (g: string) => g.slice(0, 2);
