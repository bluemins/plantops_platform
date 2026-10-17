import { notFound } from "next/navigation";
import { publicOpening } from "@/server/openings";
import { plantForPage } from "../../../plant";
import { OnePosition, TryLater } from "../../../parts";

type Params = Promise<{ code: string; id: string }>;

/** jobs.bluemins.life/<plant code>/p/<id> : one position. Mock-up 2. */
export default async function PositionPage({ params }: { params: Params }) {
  const { code, id } = await params;
  const plant = await plantForPage(code);
  if (!plant) return <TryLater />;
  const opening = await publicOpening(plant.tenantId, id);
  if (!opening) notFound();
  return <OnePosition plant={plant} opening={opening} />;
}
