import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "./header";
import { MyMonth } from "./my-month";
import { MyTabs, myTabs } from "./my-tabs";
import { OwnerNav } from "./owner-nav";
import { TodayView } from "./today";
import { todayBoard } from "@/server/today";
import { waitingClaims } from "@/server/claims";

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Attendance home. A worker: their own month. The owner, Office staff, a Supervisor (read-only) and support: the Today
 * board, and "My attendance" for anyone who is also Plant staff (a button for owners, a tab for the others).
 */
export default async function HomePage({ searchParams }: { searchParams: Search }) {
  const user = await requirePageUser("/");
  const sp = await searchParams;
  const plant = await kit.branding(user.tenantId);

  if (!can(user, "see_today") && !can(user, "see_own")) {
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>You don&apos;t have access to Attendance. Ask the plant owner.</Card>
      </div>
    );
  }

  if (!can(user, "see_today")) {
    return (
      <div className="space-y-4">
        <Header user={user} plant={plant} />
        <MyTabs {...await myTabs(user)} current="attendance" />
        <MyMonth user={user} month={typeof sp.m === "string" ? sp.m : null} base="/" />
      </div>
    );
  }

  const board = await todayBoard(user);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="today" claimsWaiting={await waitingClaims(user)} />
      <TodayView user={user} board={board} />
      {user.isOwner && can(user, "see_own") && (
        <a href="/my" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold">
          My attendance
        </a>
      )}
      {can(user, "support_log") && (
        <a href="/support-access" className="block text-sm font-semibold text-(--brand)">
          Support access
        </a>
      )}
    </div>
  );
}
