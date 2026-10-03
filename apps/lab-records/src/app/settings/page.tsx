import { redirect } from "next/navigation";
import { listParameters } from "@/server/parameters";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { Header } from "../header";
import { ParameterEditor } from "./editor";

/** Tests & limits (owner / lab lead). Changes apply to new tests; past results keep the limit they had. */
export default async function SettingsPage() {
  const user = await requirePageUser("/settings");
  if (!user.canApprove) redirect("/");
  const [plant, params] = await Promise.all([branding(user.tenantId), listParameters(user)]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <a href="/" className="text-sm font-semibold text-(--brand)">
        ← Home
      </a>
      <h1 className="text-2xl font-bold">Tests &amp; limits</h1>
      <p className="text-slate-600">
        Set your plant&apos;s allowed range for each check. A value outside it is marked FAIL automatically. Changes apply to new tests only – past
        results keep the limit they were tested against. Every change is logged.
      </p>
      <ParameterEditor initial={params} />
    </div>
  );
}
