import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { LinkButton } from "@/lib/ui";
import { can } from "@/server/access";
import { pickableItems } from "@/server/items";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { BackLink } from "../parts";
import { ComplaintForm } from "./form";

/** Log a complaint: the phone form (owner, complaint desk, plant staff). */
export default async function NewComplaintPage() {
  const user = await requirePageUser("/new");
  if (!can(user, "log")) redirect("/");
  const [plant, items] = await Promise.all([kit.branding(user.tenantId), pickableItems(user)]);

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink />
      <h1 className="text-2xl font-bold">Log a complaint</h1>
      {items.length === 0 ? (
        <Card className="space-y-3">
          <p className="text-lg font-semibold">The item list is empty</p>
          {user.isOwner ? (
            <>
              <p className="text-slate-600">Set up the item list first, so staff can pick what a complaint is about.</p>
              <LinkButton href="/items">Set up the item list</LinkButton>
            </>
          ) : (
            <p className="text-slate-600">Ask the plant owner to set up the item list.</p>
          )}
        </Card>
      ) : (
        <ComplaintForm items={items} />
      )}
    </div>
  );
}
