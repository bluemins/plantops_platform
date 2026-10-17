import { notFound } from "next/navigation";
import { istDay } from "@/lib/days";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { orNotFound } from "@/server/pages";
import { knownPerson } from "@/server/people";
import { salaryPanel } from "@/server/salary-edit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../../header";
import { ClaimForm } from "../../../../my/claims/new/claim-form";

type Search = Promise<Record<string, string | string[] | undefined>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner enters a field-duty or expense claim for one person (approved at once). The server checks it all again. */
export default async function EnterClaimPage({ params, searchParams }: { params: Promise<{ user: string }>; searchParams: Search }) {
  const { user: personId } = await params;
  const sp = await searchParams;
  const kind = sp.kind === "field_duty" ? "field_duty" : sp.kind === "expense" ? "expense" : null;
  const user = await requirePageUser(`/staff/${personId}/claims/new`);
  if (!kind || !UUID.test(personId) || !can(user, "claim_decide")) notFound();
  const [plant, person] = await Promise.all([kit.branding(user.tenantId), orNotFound(knownPerson(user, personId))]);
  const today = istDay();
  const panel = await salaryPanel(user, personId, today.slice(0, 7));
  const first = panel.history.map((h) => h.fromMonth).sort()[0];
  if (!first) notFound();
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <ClaimForm kind={kind} today={today} earliest={`${first}-01`} person={{ userId: person.userId, name: person.name }} />
    </div>
  );
}
