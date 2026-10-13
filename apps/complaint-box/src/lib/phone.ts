// The customer's mobile number: the shared rule (packages/module-kit/src/phone.ts, also used by Order Capture).
export { normalisePhone, phoneDisplay, telLink } from "@plantops/module-kit/phone";

/** C-0001, C-0042, ... C-10000 */
export const formatRef = (n: number) => `C-${String(n).padStart(4, "0")}`;
