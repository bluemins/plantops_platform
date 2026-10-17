import { publicPage } from "@/server/openings";
import { plantForPage } from "./plant";
import { OpenPositions, TryLater } from "./parts";

export const dynamic = "force-dynamic";

/** jobs.bluemins.life/ : the default plant's job page (JOBS_DEFAULT_PLANT). Mock-up 1. */
export default async function PublicHome() {
  const plant = await plantForPage(null);
  if (!plant) return <TryLater />;
  const page = await publicPage(plant.tenantId);
  return <OpenPositions plant={plant} openings={page.openings} message={page.message} />;
}
