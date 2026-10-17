import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { MyMonth } from "../my-month";
import { MyTabs, myTabs } from "../my-tabs";

type Search = Promise<Record<string, string | string[] | undefined>>;

/** "My attendance" for an owner who is also Plant staff (a worker has it on the home page). */
export default async function MyPage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/my");
  if (!can(user, "see_own")) redirect("/");
  const sp = await searchParams;
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Today
      </a>
      <MyTabs {...await myTabs(user)} current="attendance" />
      <MyMonth user={user} month={typeof sp.m === "string" ? sp.m : null} base="/my" />
    </div>
  );
}
