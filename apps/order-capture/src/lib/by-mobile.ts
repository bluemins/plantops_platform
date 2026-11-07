// "Link by mobile" on the Match screen (src/server/zoho-match.ts): the same rule for the count shown before confirming
// and for what the server then does.

/** What "Link by mobile" would do now (also shown on the screen before the owner confirms). */
export function byMobilePlan(contacts: { id: string; mobile: string | null; customer: unknown }[], customerPhones: Set<string>) {
  const open = contacts.filter((c) => !c.customer && c.mobile);
  const perMobile = new Map<string, number>();
  for (const c of open) perMobile.set(c.mobile!, (perMobile.get(c.mobile!) ?? 0) + 1);
  const toCustomer = open.filter((c) => customerPhones.has(c.mobile!)).map((c) => c.id);
  const toNew = open.filter((c) => !customerPhones.has(c.mobile!) && perMobile.get(c.mobile!) === 1).map((c) => c.id);
  return { toCustomer, toNew, shared: open.length - toCustomer.length - toNew.length };
}
