import { redirect } from "next/navigation";
import { Card } from "@plantops/ui";
import { GROUPS } from "@/lib/groups";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { getPageMessage, listOpenings } from "@/server/openings";
import { publicLink } from "@/server/public";
import { env } from "@/server/env";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { requestOrigin } from "../origin";
import { Tabs } from "../tabs";
import { MessageEditor, OpeningControls, PublicLinkButtons } from "./controls";

/** Mock-up 7: the owner's openings and the public page (PlantOps support: read-only; HR desk: not here). */
export default async function OpeningsPage() {
  const user = await requirePageUser("/openings");
  if (!can(user, "view_openings")) redirect("/applications");
  const edit = can(user, "manage_openings");
  const [plant, list, msg, origin] = await Promise.all([kit.branding(user.tenantId), listOpenings(user), getPageMessage(user), requestOrigin()]);
  const plantCode = plant?.code?.toUpperCase() ?? null;
  const link = plantCode ? publicLink(origin, { code: plantCode, isDefault: plantCode === env.defaultPlant }) : null;
  const shown = list.filter((o) => o.status === "active").length;

  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <Tabs user={user} active="openings" />
      <h1 className="sr-only">Openings</h1>

      <Card className="space-y-3">
        <h2 className="text-base font-bold">Your public page</h2>
        {link ? <p className="text-lg font-bold break-all text-(--brand)">{link.replace(/^https?:\/\//, "")}</p> : <p className="text-slate-600">The public address appears here once PlantOps can be reached.</p>}
        {link && <PublicLinkButtons link={link} />}
        <MessageEditor initial={msg.isDefault ? "" : msg.message} placeholder={msg.message} canEdit={edit} />
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold">
          Positions · {shown} shown, {list.length - shown} hidden
        </h2>
        {edit && (
          <a href="/openings/new" className="rounded-xl bg-(--brand) px-4 py-2.5 text-sm font-bold text-(--brand-contrast)">
            + Add
          </a>
        )}
      </div>

      {list.length === 0 ? (
        <Card>
          <p className="text-slate-600">No positions yet. {edit ? "Tap + Add to put your first job on the public page." : ""}</p>
          <p className="mt-1 text-sm text-slate-500">Without positions, the public page still takes resumes (&quot;Send your resume&quot;).</p>
        </Card>
      ) : (
        GROUPS.filter((g) => list.some((o) => o.grp === g.id)).map((g) => {
          const rows = list.filter((o) => o.grp === g.id);
          return (
            <section key={g.id} className="space-y-2">
              <h3 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">{g.label}</h3>
              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
                {rows.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-3 py-2.5 pr-3 pl-4">
                    <a href={`/openings/${o.id}`} className="flex min-w-0 grow flex-col gap-0.5 text-slate-900">
                      <span className="font-semibold">{o.title}</span>
                      <span className="text-sm text-slate-600">{o.applications ? `${o.applications} application${o.applications === 1 ? "" : "s"}` : "No applications yet"}</span>
                    </a>
                    <OpeningControls opening={o} first={i === 0} last={i === rows.length - 1} canEdit={edit} />
                  </div>
                ))}
              </div>
            </section>
          );
        })
      )}
      <p className="text-sm text-slate-600">Switched-off positions disappear from the public page. Nothing is deleted; past applications keep their position.</p>
      {can(user, "support_log") && (
        <a href="/support-access" className="block text-sm font-semibold text-(--brand)">
          Support access: when PlantOps support looked
        </a>
      )}
    </div>
  );
}

