import { redirect } from "next/navigation";
import { can } from "@/server/access";
import { kit } from "@/server/kit";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { BackLink } from "../../../parts";
import { JarImport } from "./jar-import";

/** Owner only: bring the 20 L customers and what they owe in from the 20 L pending report (cash book step C2). */
export default async function JarImportPage() {
  const user = await requirePageUser("/cash/jar/import");
  if (!can(user, "jar_import")) redirect("/cash/jar");
  const plant = await kit.branding(user.tenantId);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <BackLink href="/cash/jar">← 20 L customers</BackLink>
      <h1 className="text-2xl font-bold">Import 20 L customers</h1>
      <JarImport />
    </div>
  );
}
