/**
 * Only paths inside this module, so the login callback can't be used to send someone to another site. Anything else
 * gives `fallback` (the module's home page).
 */
export const safeNext = (v: string | null | undefined, fallback = "/") =>
  v && v.startsWith("/") && !v.startsWith("//") && !/[\\\s]/.test(v) && v.length <= 500 ? v : fallback;
