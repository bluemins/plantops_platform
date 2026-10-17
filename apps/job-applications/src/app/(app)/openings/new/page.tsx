import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackToOpenings } from "../back";
import { OpeningForm } from "../form";

/** Mock-up 8, adding: a new position (owner only). */
export default async function NewOpeningPage() {
  const user = await requirePageUser("/openings/new");
  if (!can(user, "manage_openings")) redirect("/openings");
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackToOpenings />
      <h1 className="text-2xl font-bold">Add position</h1>
      <OpeningForm id={null} received={0} canEdit initial={{ title: "", grp: "production", tag: null, description: "", minQualification: "", goodToHave: null, status: "active" }} />
    </div>
  );
}
