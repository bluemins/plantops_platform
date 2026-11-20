// Bill copy on purchase bills (owner, 2026-11-20; migration 0026): the owner and Accounts add a PDF or photos to a
// purchase bill (also a Zoho-imported one); the type is checked by the file's bytes, ≤ 10 MB, the plan's Sales storage
// limit; the owner, Accounts and support (logged) read them; Order desk, plant staff, Store keepers and marketing never;
// another plant's file is "not found"; a cancelled bill takes no new copy; the list counts the copies.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kit } from "@/server/kit";
import { addVendor, cancelPurchaseBill, recordPurchaseBill } from "@/server/purchase-entry";
import { addPurchaseBillCopy, MAX_COPY_BYTES, readPurchaseBillCopy } from "@/server/purchase-files";
import { purchaseBillDetail, purchaseBillsList } from "@/server/purchases";
import { asApp, auditRows, ocUser, plant, refused } from "./helpers";

const a = plant();
const b = plant();
const accounts = ocUser(a.tenantId, ["accounts"], "Anmol");
const marketing = ocUser(a.tenantId, ["marketing_staff"], "Ravi");

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(2000, 32), Buffer.from("\n%%EOF")]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);

let planMb: number | undefined;
beforeEach(() => {
  vi.spyOn(kit, "branding").mockResolvedValue({ name: "Bluemins", brand_color: "#2a3a9a", logo_url: null, gstin: "21ABCDE1234F1Z5" } as never);
  vi.spyOn(kit, "plan").mockImplementation(async () => ({ limits: { platform: {}, modules: planMb ? { order_capture: { storage_mb: planMb } } : {} } }) as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  planMb = undefined;
});

const ids = { bill: "", other: "", pdf: "", photo: "", bBill: "" };

describe("purchase bill copies", () => {
  it("setup: a vendor and two bills in plant A, one in plant B", async () => {
    const v = await addVendor(a.owner, { name: "Shree Preforms", gstin: "", state: "21", active: true } as never);
    const line = { item_name: "Preform 18.5 g", quantity: "12", unit: "pkt", rate: "800", gst_rate: 18 };
    ids.bill = (await recordPurchaseBill(accounts, { vendor_id: v.id, bill_date: "2026-11-20", adjustment: "0", lines: [line] } as never)).id;
    ids.other = (await recordPurchaseBill(a.owner, { vendor_id: v.id, bill_date: "2026-11-19", adjustment: "0", lines: [line] } as never)).id;
    const vb = await addVendor(b.owner, { name: "Other plant vendor", gstin: "", state: "21", active: true } as never);
    ids.bBill = (await recordPurchaseBill(b.owner, { vendor_id: vb.id, bill_date: "2026-11-20", adjustment: "0", lines: [line] } as never)).id;
  });

  it("Accounts adds a PDF and the owner a photo; the page lists them oldest first, the list counts them, audited", async () => {
    const p = await addPurchaseBillCopy(accounts, ids.bill, PDF, "SP-1142.pdf");
    expect(p).toMatchObject({ content_type: "application/pdf", size: PDF.length });
    ids.pdf = p.id;
    ids.photo = (await addPurchaseBillCopy(a.owner, ids.bill, JPEG, "photo.jpg")).id;
    const d = await purchaseBillDetail(a.owner, ids.bill);
    expect(d.copies.map((c) => [c.file_name, c.content_type, c.by])).toEqual([["SP-1142.pdf", "application/pdf", "Anmol"], ["photo.jpg", "image/jpeg", "Sujata"]]);
    const list = await purchaseBillsList(accounts);
    expect(list.bills.find((x) => x.id === ids.bill)?.copies).toBe(2);
    expect(list.bills.find((x) => x.id === ids.other)?.copies).toBe(0);
    expect((await auditRows(a.tenantId)).filter((r) => r.action === "purchase.bill_copy")).toHaveLength(2);
  });

  it("the file comes back byte for byte to the owner, Accounts and support; support's view is logged", async () => {
    for (const u of [a.owner, accounts, a.support]) expect((await readPurchaseBillCopy(u, ids.pdf)).data.equals(PDF), u.name).toBe(true);
    expect((await readPurchaseBillCopy(a.owner, ids.photo)).contentType).toBe("image/jpeg");
    const views = (await asApp(a.tenantId, `select path from order_capture.support_views where path like '/purchase-bill-files/%'`)).rows;
    expect(views).toEqual([{ path: `/purchase-bill-files/${ids.pdf}` }]);
  });

  it("Order desk, plant staff, Store keepers and marketing can't read or add; support can't add", async () => {
    for (const u of [a.desk, a.staff, a.keeper, marketing]) {
      expect((await refused(() => readPurchaseBillCopy(u, ids.pdf))).status, u.name).toBe(403);
      expect((await refused(() => addPurchaseBillCopy(u, ids.bill, PDF))).status, u.name).toBe(403);
    }
    expect((await refused(() => addPurchaseBillCopy(a.support, ids.bill, PDF))).status).toBe(403);
  });

  it("another plant: its file and its bill are not found", async () => {
    expect((await refused(() => readPurchaseBillCopy(b.owner, ids.pdf))).status).toBe(404);
    expect((await refused(() => addPurchaseBillCopy(b.owner, ids.bill, PDF))).status).toBe(404);
    expect((await refused(() => addPurchaseBillCopy(a.owner, ids.bBill, PDF))).status).toBe(404);
    expect((await purchaseBillDetail(b.owner, ids.bBill)).copies).toEqual([]);
  });

  it("only a PDF or a photo, by its bytes; empty and over 10 MB refused", async () => {
    expect((await refused(() => addPurchaseBillCopy(a.owner, ids.other, Buffer.from("<html><script>x</script></html>"), "bill.pdf"))).status).toBe(415);
    expect((await refused(() => addPurchaseBillCopy(a.owner, ids.other, Buffer.alloc(0)))).status).toBe(400);
    const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(MAX_COPY_BYTES, 32)]);
    expect((await refused(() => addPurchaseBillCopy(a.owner, ids.other, big))).status).toBe(413);
    expect((await purchaseBillDetail(a.owner, ids.other)).copies).toEqual([]);
  });

  it("the plan's Sales storage limit: full = refused, nothing saved", async () => {
    planMb = 1;
    const nearlyMb = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1024 * 1024 - 1000, 32)]);
    expect((await refused(() => addPurchaseBillCopy(a.owner, ids.other, nearlyMb))).message).toMatch(/Storage full/);
    planMb = 50;
    await addPurchaseBillCopy(a.owner, ids.other, nearlyMb, "  odd/\\name\u0001.pdf ");
    expect((await purchaseBillDetail(a.owner, ids.other)).copies[0]?.file_name).toBe("oddname.pdf");
  });

  it("a cancelled bill takes no new copy, but its copies stay readable", async () => {
    await cancelPurchaseBill(a.owner, ids.bill, { reason: "Entered twice" } as never);
    expect((await refused(() => addPurchaseBillCopy(accounts, ids.bill, JPEG))).status).toBe(409);
    expect((await purchaseBillDetail(accounts, ids.bill)).copies).toHaveLength(2);
    expect((await readPurchaseBillCopy(accounts, ids.photo)).data.equals(JPEG)).toBe(true);
  });
});
