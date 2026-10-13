// A customer's mobile number: typed any way staff like, stored as 10 digits for matching and tap-to-call. One rule
// for every module that keeps customer phones (Complaint Box, Order Capture).

/**
 * "+91 98765 43210", "09876543210", "919876543210", "98765-43210" ... -> "9876543210". Spaces, dashes, dots and
 * brackets are removed; a leading +91, 91 (12 digits) or 0 (11 digits) is dropped. null unless the result is an
 * Indian mobile number (10 digits starting 6-9).
 */
export function normalisePhone(typed: string): string | null {
  let d = typed.replace(/[\s\-.()]/g, "");
  if (d.startsWith("+91")) d = d.slice(3);
  else if (/^91\d{10}$/.test(d)) d = d.slice(2);
  else if (/^0\d{10}$/.test(d)) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

/** The link that dials the customer from a phone. */
export const telLink = (phone: string) => `tel:+91${phone}`;

/** How the number is shown: "98765 43210", as a tap-to-call link - except in the read-only support view. */
export const phoneDisplay = (phone: string, plain = false) => ({ text: `${phone.slice(0, 5)} ${phone.slice(5)}`, href: plain ? null : telLink(phone) });
