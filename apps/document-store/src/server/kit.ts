// Document Store's connection to the platform, from the shared module kit (packages/module-kit).
import { createModule } from "@plantops/module-kit";
import { env } from "./env";
import { outboxStore } from "./outbox";

export const kit = createModule({
  moduleId: "document_store",
  label: "Document Store",
  outbox: outboxStore,
  env: {
    platformUrl: () => env.platformUrl,
    clientSecret: () => env.clientSecret,
    sessionSecret: () => env.sessionSecret,
    secureCookies: () => env.secureCookies,
  },
});
