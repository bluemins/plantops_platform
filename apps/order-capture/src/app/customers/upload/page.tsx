import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackLink } from "../../parts";
import { UploadWizard } from "./wizard";

/** Owner only: upload a customer list (CSV), see what would happen, then save. */
export default async function UploadPage() {
  const user = await requirePageUser("/customers/upload");
  if (!can(user, "customer_upload")) redirect("/customers");
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Upload customers</h1>
      <UploadWizard />
    </div>
  );
}
