/** Only paths inside this module, so the login callback can't be used to send someone to another site. */
export const safeNext = (v: string | null | undefined) =>
  v && v.startsWith("/") && !v.startsWith("//") && !/[\\\s]/.test(v) && v.length <= 500 ? v : "/";
