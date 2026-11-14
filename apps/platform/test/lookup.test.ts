// Module-to-module lookup ticket (docs/FIELD_DAY_PHASE_PLAN.md Phase 1): only the pairs in LOOKUPS, only with module
// credentials, only when the plant is active and both modules are switched on for it. The ticket is for the target
// module, one plant and one scope, and lives 60 seconds.
import { decodeJwt } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import * as ticketRoute from "@/app/api/m/tenants/[tid]/lookup-ticket/route";
import { sha256 } from "@/server/crypto";
import { asOwner, call, makePlant, type Handler } from "./helpers";

const ATT_SECRET = "attendance-lookup-secret";
const STOCK_SECRET = "stock-lookup-secret";
const basic = (id: string, secret: string) => ({ authorization: "Basic " + btoa(`${id}:${secret}`) });
const ATT = basic("attendance_salary", ATT_SECRET);

let A: Awaited<ReturnType<typeof makePlant>>;
const ask = (body: unknown, headers: Record<string, string> = ATT, tid = A.tenantId) => call(ticketRoute.POST as Handler, { headers, params: { tid }, body });

beforeAll(async () => {
  await asOwner("update platform.modules set base_url = 'https://attendance.example.test', client_secret_hash = $1, status = 'active' where id = 'attendance_salary'", [sha256(ATT_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://stock.example.test', client_secret_hash = $1, status = 'active' where id = 'floor_stock'", [sha256(STOCK_SECRET)]);
  await asOwner("update platform.modules set base_url = 'https://orders.example.test', status = 'active' where id = 'order_capture'");
  A = await makePlant({ modules: ["attendance_salary", "order_capture", "floor_stock", "lab_records"] });
});

describe("lookup ticket", () => {
  it("Attendance gets a 60-second ticket for Sales, for this plant and this scope, plus Sales' address", async () => {
    for (const scope of ["customers", "customer_location"] as const) {
      const r = await ask({ to: "order_capture", scope });
      expect(r.status).toBe(200);
      expect(r.body.url).toBe("https://orders.example.test");
      const p = decodeJwt(r.body.ticket as string);
      expect(p).toMatchObject({ iss: "plantops-platform", aud: "order_capture", purpose: "lookup", tenant_id: A.tenantId, from: "attendance_salary", scope });
      expect(p.exp! - p.iat!).toBe(60);
      expect(p).not.toHaveProperty("user_id");
      expect(p).not.toHaveProperty("roles");
    }
  });

  it("refused without module credentials or with a wrong secret", async () => {
    expect((await ask({ to: "order_capture", scope: "customers" }, {})).status).toBe(401);
    expect((await ask({ to: "order_capture", scope: "customers" }, basic("attendance_salary", "wrong"))).status).toBe(401);
  });

  it("refused for a pair or scope not in LOOKUPS", async () => {
    expect((await ask({ to: "order_capture", scope: "customers" }, basic("floor_stock", STOCK_SECRET))).status).toBe(403);
    expect((await ask({ to: "lab_records", scope: "customers" })).status).toBe(403);
    expect((await ask({ to: "order_capture", scope: "orders" })).status).toBe(400);
    expect((await ask({ to: "order_capture", scope: "customers", extra: 1 })).status).toBe(400);
  });

  it("refused when either module is off for the plant, or the plant is suspended", async () => {
    const noSales = await makePlant({ modules: ["attendance_salary"] });
    expect((await ask({ to: "order_capture", scope: "customers" }, ATT, noSales.tenantId)).status).toBe(403);
    const noAttendance = await makePlant({ modules: ["order_capture"] });
    expect((await ask({ to: "order_capture", scope: "customers" }, ATT, noAttendance.tenantId)).status).toBe(403);
    const S = await makePlant({ modules: ["attendance_salary", "order_capture"] });
    expect((await ask({ to: "order_capture", scope: "customers" }, ATT, S.tenantId)).status).toBe(200);
    await asOwner("update platform.tenants set status = 'suspended' where id = $1", [S.tenantId]);
    expect((await ask({ to: "order_capture", scope: "customers" }, ATT, S.tenantId)).status).toBe(403);
  });

  it("an unknown plant is refused the same way", async () => {
    expect((await ask({ to: "order_capture", scope: "customers" }, ATT, "00000000-0000-4000-8000-000000000000")).status).toBe(403);
  });
});
