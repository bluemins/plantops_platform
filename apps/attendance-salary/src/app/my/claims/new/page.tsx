import { notFound } from "next/navigation";
import { myClaims } from "@/server/claims";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { ClaimForm } from "./claim-form";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** + Field duty / + Expense (mock-ups 3 and 4): your own claim, today back to 31 days. The server checks it all again. */
export default async function NewClaimPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const kind = sp.kind === "field_duty" ? "field_duty" : sp.kind === "expense" ? "expense" : null;
  const user = await requirePageUser(`/my/claims/new?kind=${kind ?? ""}`);
  if (!kind) notFound();
  const [plant, v] = await Promise.all([kit.branding(user.tenantId), orNotFound(myClaims(user, null))]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <ClaimForm kind={kind} today={v.today} earliest={v.earliest} />
    </div>
  );
}
