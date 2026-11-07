import { notFound, redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { account, istToday } from "@/server/ledger";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { AccountView, pickTab } from "../../account-view";
import { Header } from "../../header";
import { BackLink } from "../../parts";

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** A customer's account: bills, orders, payments, statement (owner, Accounts, Marketing staff; support read-only). */
export default async function CustomerAccountPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await requirePageUser(`/customers/${id}`);
  if (!can(user, "account_view")) redirect("/customers");
  const sp = await searchParams;
  const tab = pickTab(one(sp.tab));
  const range = { from: one(sp.from) || undefined, to: one(sp.to) || undefined };
  const fy = /^\d{4}$/.test(one(sp.fy)) ? Number(one(sp.fy)) : undefined;
  const [plant, a] = await Promise.all([kit.branding(user.tenantId), orNotFound(account(user, { kind: "customer", id }, { ...range, fy }))]);
  return (
    <div className="space-y-4 pb-8">
      <div className="print:hidden"><Header user={user} plant={plant} /></div>
      <div className="print:hidden"><BackLink href="/customers">← Customers</BackLink></div>
      <AccountView user={user} a={a} tab={tab} base={`/customers/${id}`} range={range} today={istToday()} show={{ bills: one(sp.bs), pays: one(sp.ps) }} plant={plant ? { name: plant.name, gstin: plant.gstin } : undefined} />
    </div>
  );
}
