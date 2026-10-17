import { notFound } from "next/navigation";
import { PlatformUnavailable, resolvePublicPlant, type PublicPlantView } from "@/server/public";

/**
 * The plant behind a public address, or Next's not-found page (one answer for every reason). When PlantOps can't be
 * reached, `null` comes back and the page shows "try again in a few minutes" instead of "not available".
 */
export async function plantForPage(code: string | null): Promise<PublicPlantView | null> {
  try {
    const plant = await resolvePublicPlant(code);
    if (!plant) notFound();
    return plant;
  } catch (err) {
    if (err instanceof PlatformUnavailable) return null;
    throw err;
  }
}
