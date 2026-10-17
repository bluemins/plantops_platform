import { consentText } from "@/lib/apply";
import { env } from "@/server/env";
import { publicPage } from "@/server/openings";
import { basePath } from "@/server/public";
import { turnstileOn } from "@/server/turnstile";
import { ApplyForm } from "./apply-form";
import { Branded, TryLater } from "./parts";
import { plantForPage } from "./plant";

/** Mock-up 3 for the bare address (`code` null) or /<code>; `?o=<id>` preselects that open position. */
export async function ApplyPage({ code, o }: { code: string | null; o: string | undefined }) {
  const plant = await plantForPage(code);
  if (!plant) return <TryLater />;
  const { openings } = await publicPage(plant.tenantId);
  const preselect = openings.some((x) => x.id === o) ? o! : "any";
  return (
    <Branded plant={plant}>
      <ApplyForm
        plantName={plant.name}
        action={`/api/apply/${plant.code}`}
        base={basePath(plant)}
        openings={openings.map(({ id, title }) => ({ id, title }))}
        preselect={preselect}
        consent={consentText(plant.name)}
        turnstileSiteKey={turnstileOn() ? env.turnstileSiteKey : ""}
      />
    </Branded>
  );
}
