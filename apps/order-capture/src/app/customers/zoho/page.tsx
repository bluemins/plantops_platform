import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";
import { ZohoImport } from "./zoho-import";

/** Owner only: bring Zoho's contacts, invoices and payments into the sales ledger (docs/ZOHO_IMPORT_PHASE_PLAN.md). */
export default async function ZohoImportPage() {
  const user = await requirePageUser("/customers/zoho");
  if (!can(user, "zoho_import")) redirect("/customers");
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Import from Zoho</h1>
      <ZohoImport />
    </div>
  );
}
