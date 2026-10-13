import { manifestFor, PLANTOPS_APP } from "@/server/app-icon";

/**
 * Makes PlantOps installable ("Add to Home Screen"); an installed app can receive phone notifications. A logged-in
 * plant user's pages point to their plant's own install details instead (src/app/plant-app/[token]).
 */
export function GET() {
  return Response.json(manifestFor(PLANTOPS_APP, ""), { headers: { "content-type": "application/manifest+json" } });
}
