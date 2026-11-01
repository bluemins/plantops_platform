import { redirect } from "next/navigation";
import { ownerPageAccess, pageUser } from "@/server/page-guard";
import { BankRemarks } from "./bank-remarks";

export const dynamic = "force-dynamic";

/** Owner only (owner, 2026-11-01): checked here on the server, so staff never get the page, not just no link. */
export default async function BankRemarksPage() {
  const access = ownerPageAccess(await pageUser(), "/admin/bank-remarks");
  if (!access.ok) redirect(access.to);
  return <BankRemarks plantKey={access.user.tenantId} />;
}
