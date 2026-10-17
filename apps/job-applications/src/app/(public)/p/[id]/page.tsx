import { notFound } from "next/navigation";
import { publicOpening } from "@/server/openings";
import { plantForPage } from "../../plant";
import { OnePosition, TryLater } from "../../parts";

type Params = Promise<{ id: string }>;

/** jobs.bluemins.life/p/<id> : one position of the default plant. Mock-up 2. */
export default async function DefaultPositionPage({ params }: { params: Params }) {
  const plant = await plantForPage(null);
  if (!plant) return <TryLater />;
  const opening = await publicOpening(plant.tenantId, (await params).id);
  if (!opening) notFound();
  return <OnePosition plant={plant} opening={opening} />;
}
