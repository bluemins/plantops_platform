import { notFound } from "next/navigation";
import { Card } from "@plantops/ui";
import { can } from "@/server/access";
import { deskList } from "@/server/desk";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { OwnerNav } from "../owner-nav";
import { DeskList } from "./desk-list";

/**
 * Office staff: "Mark for someone" (docs/ATTENDANCE_ROLES_PHASE_PLAN.md mock-up 1). Every active employee with their
 * state now and one Mark IN / Mark OUT button; the office phone's location is checked like a scan. Never yourself.
 */
export default async function DeskPage() {
  const user = await requirePageUser("/desk");
  const plant = await kit.branding(user.tenantId);
  if (!can(user, "mark_for")) {
    if (user.isSupport) notFound();
    return (
      <div className="space-y-5">
        <Header user={user} plant={plant} />
        <Card>You don&apos;t have access to this page. Only Office staff can mark for someone. Ask the plant owner.</Card>
        <a href="/" className="flex min-h-11 items-center justify-center font-semibold text-(--brand)">
          Back to Attendance
        </a>
      </div>
    );
  }
  const list = await deskList(user);
  return (
    <div className="space-y-4">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="desk" />
      {list.platformDown && <Card>PlantOps can&apos;t be reached right now, so the staff list is empty. Try again in a minute.</Card>}
      {!list.locationSet ? <Card>The owner hasn&apos;t set the plant location yet, so nobody can be marked from here.</Card> : <DeskList people={list.people} />}
    </div>
  );
}
