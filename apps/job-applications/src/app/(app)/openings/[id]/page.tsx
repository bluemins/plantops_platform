import { redirect } from "next/navigation";
import { orNotFound } from "@plantops/module-kit/pages";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { getOpening } from "@/server/openings";
import { requirePageUser } from "@/server/session";
import { Header } from "../../header";
import { BackToOpenings } from "../back";
import { OpeningForm } from "../form";

type Params = Promise<{ id: string }>;

/** Mock-up 8: edit a position (owner; PlantOps support sees it read-only). */
export default async function EditOpeningPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requirePageUser(`/openings/${id}`);
  if (!can(user, "view_openings")) redirect("/applications");
  const [plant, o] = await Promise.all([kit.branding(user.tenantId), orNotFound(getOpening(user, id))]);
  const { id: _id, sortOrder: _s, applications, ...initial } = o;
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <BackToOpenings />
      <h1 className="text-2xl font-bold">{can(user, "manage_openings") ? "Edit position" : o.title}</h1>
      <OpeningForm id={o.id} initial={initial} received={applications} canEdit={can(user, "manage_openings")} />
    </div>
  );
}
