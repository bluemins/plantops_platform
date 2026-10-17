// Job applications' connection to the platform, from the shared module kit (packages/module-kit).
import { createModule } from "@plantops/module-kit";
import { env } from "./env";
import { outboxStore } from "./outbox";

export const kit = createModule({
  moduleId: "job_applications",
  label: "Job applications",
  // "/" is the public job page, so a login (and the support view) lands on the list of applications instead
  homePath: "/applications",
  outbox: outboxStore,
  env: {
    platformUrl: () => env.platformUrl,
    clientSecret: () => env.clientSecret,
    sessionSecret: () => env.sessionSecret,
    secureCookies: () => env.secureCookies,
  },
});
