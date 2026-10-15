import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { settingsFor } from "@/server/settings";
import { Header } from "../header";
import { OwnerNav } from "../owner-nav";
import { SettingsEditor } from "./editor";

/** Owner: Location & QR (mock-up "Owner · Settings"). PlantOps support sees it read-only. */
export default async function SettingsPage() {
  const user = await requirePageUser("/settings");
  if (!can(user, "view_settings")) redirect("/");
  const [plant, settings] = await Promise.all([kit.branding(user.tenantId), settingsFor(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <OwnerNav user={user} current="settings" />
      <h1 className="text-2xl font-bold">Location &amp; QR</h1>
      <SettingsEditor initial={settings} canEdit={can(user, "settings")} />
    </div>
  );
}
