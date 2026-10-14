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

/** The plant's customers: owner and Order desk add / edit / switch off; PlantOps support reads. */
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
      <BackLink />
      <h1 className="text-2xl font-bold">Customers</h1>
      {can(user, "customer_upload") && (
        <LinkRow href="/customers/upload" note="From Google Sheets, Excel or Zoho (CSV)">
          Upload a customer list
        </LinkRow>
      )}
      <CustomersEditor list={list} q={q} showOff={showOff} canEdit={can(user, "customers")} plainPhones={user.isSupport} />
    </div>
  );
}
