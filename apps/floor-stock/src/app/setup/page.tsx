import { productLabel } from "@plantops/module-kit";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { getSettings } from "@/server/settings";
import { listSetup } from "@/server/setup";
import { starterTemplate } from "@/lib/template";
import { Header } from "../header";
import { SetupEditor } from "./editor";
import { ReminderSetting } from "./reminder";

/** "Sections & items": the plant's own list of what is counted each evening. */
export default async function SetupPage() {
  const user = await requirePageUser("/setup");
  const [plant, sections, skus, settings] = await Promise.all([kit.branding(user.tenantId), listSetup(user), kit.products(user.tenantId), getSettings(user)]);
  const products = skus.map((s) => ({ id: s.id, label: productLabel(s), active: s.status === "active" }));
  // first start: what the starter list would create, so the owner sees it before saying yes
  const template = sections.length === 0 && user.isOwner ? starterTemplate(skus).map((s) => ({ name: s.name, kind: s.kind, items: s.items.map((i) => i.name) })) : null;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Floor Stock
      </a>
      <h1 className="text-2xl font-bold">Sections &amp; items</h1>
      <ReminderSetting value={settings.count_reminder} canChange={user.isOwner && !user.isSupport} />
      <SetupEditor
        sections={sections}
        products={products}
        template={template}
        can={{ owner: user.isOwner, edit: user.canCount && !user.isSupport }}
      />
    </div>
  );
}
