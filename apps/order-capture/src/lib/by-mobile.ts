// "Link by mobile" on the Match screen (src/server/zoho-match.ts): the same rule for the counts shown before confirming
// and for what the server then does. The same mobile is the same customer (a customer's phone is unique per plant).

/** What "Link by mobile" would do now (also shown on the screen before the owner confirms). */
export function byMobilePlan(contacts: { id: string; mobile: string | null; customer: unknown }[], customerPhones: Set<string>) {
  const open = contacts.filter((c) => !c.customer && c.mobile);
  const perMobile = new Map<string, number>();
  for (const c of open) if (!customerPhones.has(c.mobile!)) perMobile.set(c.mobile!, (perMobile.get(c.mobile!) ?? 0) + 1);
  const toCustomer = open.filter((c) => customerPhones.has(c.mobile!)).length;
  const toNew = [...perMobile.values()].filter((n) => n === 1).length;
  const sharedMobiles = [...perMobile.values()].filter((n) => n > 1);
  return { toCustomer, toNew, sharedContacts: sharedMobiles.reduce((a, n) => a + n, 0), sharedMobiles: sharedMobiles.length };
}

/**
 * The order the server links in: per mobile, the contact billed most recently first (never billed last, then by name),
 * so a new customer for a shared mobile takes that contact's name.
 */
export function newestFirst<T extends { name: string; last_bill: string | null }>(xs: T[]) {
  return [...xs].sort((a, b) => (b.last_bill ?? "").localeCompare(a.last_bill ?? "") || a.name.localeCompare(b.name));
}
