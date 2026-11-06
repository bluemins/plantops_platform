import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { matchData } from "@/server/zoho-match";
import { Header } from "../../header";
import { BackLink } from "../../parts";
import { MatchScreen } from "./match";

/** Owner only: every Zoho contact next to the plant's customers, so nothing is missed. */
export default async function MatchPage() {
  const user = await requirePageUser("/customers/match");
  if (!can(user, "zoho_match")) redirect("/customers");
  const [plant, data] = await Promise.all([kit.branding(user.tenantId), matchData(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink href="/customers">← Customers</BackLink>
      <h1 className="text-2xl font-bold">Match Zoho customers</h1>
      <MatchScreen data={data} />
    </div>
  );
}
