// Android staff app (TWA): proves this address belongs to the PlantOps app. See packages/auth/src/assetlinks.ts.
import { assetLinksResponse } from "@plantops/auth";

export const dynamic = "force-dynamic";
export const GET = () => assetLinksResponse();
