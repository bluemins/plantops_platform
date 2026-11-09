import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { listCustomers } from "@/server/customers";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink, LinkRow } from "../parts";
import { CustomersEditor } from "./editor";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** The plant's customers: owner, Order desk and Marketing staff add / edit / switch off; PlantOps support reads. */
export default async function CustomersPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/customers");
  if (!can(user, "view_customers")) redirect("/");
  const sp = await searchParams;
  const q = one(sp.q).slice(0, 100);
  const showOff = one(sp.off) === "1";
  const [plant, list] = await Promise.all([kit.branding(user.tenantId), listCustomers(user, { q, showOff })]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      {can(user, "read") && <BackLink />}
      <h1 className="text-2xl font-bold">Customers</h1>
      {!can(user, "read") && can(user, "location_view") && (
        <LinkRow href="/shops" note="Find a shop and its saved pin">
          Shop locations
        </LinkRow>
      )}
      <CustomersEditor list={list} q={q} showOff={showOff} canEdit={can(user, "customers")} plainPhones={user.isSupport} accounts={can(user, "account_view")} dropPhones={can(user, "drop_phones")} />
      {can(user, "drop_shops") && (
        <LinkRow href="/customers/drop" note="Shops switched on for the Drop app, last logins">
          Drop shops
        </LinkRow>
      )}
      {can(user, "drop_rewards_view") && (
        <LinkRow href="/customers/drop/rewards" note="Free boxes shops asked for with Drop points">
          Free boxes asked
        </LinkRow>
      )}
      {can(user, "drop_points_view") && (
        <LinkRow href="/customers/drop/points" note="₹ per point, late payments, free boxes, start date">
          Drop points settings
        </LinkRow>
      )}
      {can(user, "customer_upload") && (
        <LinkRow href="/customers/upload" note="From Google Sheets, Excel or Zoho (CSV)">
          Upload a customer list
        </LinkRow>
      )}
      {can(user, "zoho_import") && (
        <LinkRow href="/customers/zoho" note="Contacts, invoices and payments from Zoho Books (CSV)">
          Import from Zoho
        </LinkRow>
      )}
      {can(user, "zoho_match") && (
        <LinkRow href="/customers/match" note="Link every Zoho contact to one of your customers">
          Match Zoho customers
        </LinkRow>
      )}
    </div>
  );
}
