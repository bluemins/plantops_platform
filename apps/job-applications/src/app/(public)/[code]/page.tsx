import { publicPage } from "@/server/openings";
import { plantForPage } from "../plant";
import { OpenPositions, TryLater } from "../parts";

type Params = Promise<{ code: string }>;

/** jobs.bluemins.life/<plant code> : that plant's job page. Mock-up 1. */
export default async function PlantPublicPage({ params }: { params: Params }) {
  const plant = await plantForPage((await params).code);
  if (!plant) return <TryLater />;
  const page = await publicPage(plant.tenantId);
  return <OpenPositions plant={plant} openings={page.openings} message={page.message} />;
}
