import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { addChoices } from "@/server/add";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { AddForm } from "./add-form";

/** "+ Add applicant" (owner, HR desk): someone who phoned or walked in (owner, 2026-11-01). */
export default async function AddApplicantPage() {
  const user = await requirePageUser("/applications/new");
  if (!can(user, "add")) redirect("/applications");
  const [plant, openings] = await Promise.all([kit.branding(user.tenantId), addChoices(user)]);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href="/applications" className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-(--brand)">
        ‹ Applications
      </a>
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Add applicant</h1>
        <p className="text-sm text-slate-600">Someone who phoned or came to the plant. They get a reference and appear in the list like any application.</p>
      </div>
      <AddForm plantName={plant?.name ?? "the plant"} openings={openings} />
    </div>
  );
}
