import { redirect } from "next/navigation";
import { getEntry } from "@/server/entries";
import { uuidParam } from "@/server/http";
import { orNotFound } from "@/server/pages";
import { branding } from "@/server/platform";
import { requirePageUser } from "@/server/session";
import { Header } from "../../../header";
import { CorrectionForm } from "./form";

type Props = { params: Promise<{ id: string }> };

export default async function CorrectPage({ params }: Props) {
  const { id } = await params;
  const user = await requirePageUser(`/entries/${id}/correct`);
  if (!user.canEnter) redirect(`/entries/${id}`);
  const [plant, entry] = await Promise.all([branding(user.tenantId), orNotFound(getEntry(user, uuidParam(id)))]);
  return (
    <div className="space-y-5">
      <Header user={user} plant={plant} />
      <h1 className="text-2xl font-bold">Correct a test</h1>
      <p className="text-slate-600">
        Fix a mistake in what was entered. This adds version {entry.current.version + 1}; version {entry.current.version} stays on record. For a new
        measurement, add a new test (retest) instead.
      </p>
      <CorrectionForm entry={entry} />
    </div>
  );
}
