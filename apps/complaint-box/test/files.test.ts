// Phase 4: a complaint's photos and video. Type by content, size, count, the plan's storage limit, who may add
// them (whoever logged it or the owner, within 24 hours), plant isolation, and the download with byte ranges.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as uploadRoute } from "@/app/api/complaints/[id]/files/route";
import { GET as download } from "@/app/files/[id]/route";
import { ComplaintInput, createComplaint } from "@/server/complaints";
import { parseRange, readComplaintFile, uploadComplaintFile } from "@/server/files";
import { createItem } from "@/server/items";
import { kit } from "@/server/kit";
import { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } from "@/server/storage";
import type { CbUser } from "@/server/session";
import { startFakePlatform, type FakePlatform } from "./fake-platform";
import { asOwner, HEIC, HTML, JPEG, MOV, MP4, PDF, plant, PNG, refused, sized, SVG, WEBP } from "./helpers";

let platform: FakePlatform;
beforeAll(async () => {
  platform = await startFakePlatform();
  process.env.PLATFORM_URL = platform.url;
});
afterAll(() => platform.close());

const input = { customer_name: "Ramesh", phone: "9876543210", place: "Kalinga Nagar", description: "Jar leaking from the cap" };
/** A plant with one complaint logged by its complaint desk user. */
async function setup() {
  const p = plant();
  const item = await createItem(p.owner, { name: "20 L jar" });
  const c = await createComplaint(p.desk, ComplaintInput.parse({ ...input, item_id: item.id }));
  return { p, c };
}
const up = (u: CbUser, complaintId: string, data: Buffer, now?: number) => uploadComplaintFile(u, complaintId, data, { now });

/** Runs `fn` as if `user` were logged in (the routes read the session themselves). */
async function as<T>(user: CbUser, fn: () => Promise<T>) {
  const spy = vi.spyOn(kit, "currentSession");
  spy.mockResolvedValue(
    user.isSupport
      ? ({ kind: "support", support: { tenant_id: user.tenantId, super_admin_id: user.userId, read_only: true, expires_at: Date.now() + 60_000 } } as never)
      : ({ kind: "user", session: { tenant_id: user.tenantId, user_id: user.userId, display_name: user.name, roles: user.roles, enabled_modules: ["complaint_box"], login_at: Date.now(), checked_at: Date.now() } } as never),
  );
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

describe("type by content", () => {
  it.each([
    ["JPEG", JPEG, "photo", "image/jpeg"],
    ["PNG", PNG, "photo", "image/png"],
    ["WebP", WEBP, "photo", "image/webp"],
    ["MP4", MP4, "video", "video/mp4"],
    ["MOV (iPhone)", MOV, "video", "video/quicktime"],
  ])("%s is accepted", async (_, data, kind, type) => {
    const { p, c } = await setup();
    const f = await up(p.desk, c.id, data);
    expect(f.kind).toBe(kind);
    expect((await asOwner("select content_type from complaint_box.files where id = $1", [f.id])).rows[0]).toEqual({ content_type: type });
  });

  it.each([
    ["PDF", PDF],
    ["SVG", SVG],
    ["HTML", HTML],
    ["HEIC (an iPhone photo that wasn't shrunk)", HEIC],
  ])("%s is refused", async (_, data) => {
    const { p, c } = await setup();
    expect(await refused(() => up(p.desk, c.id, data))).toEqual({ status: 415, message: "Only photos (JPG, PNG, WebP) and videos (MP4, MOV) can be added" });
  });

  it("an empty file is refused", async () => {
    const { p, c } = await setup();
    expect(await refused(() => up(p.desk, c.id, Buffer.alloc(0)))).toEqual({ status: 400, message: "The file is empty" });
  });
});

describe("size and count", () => {
  it("a photo up to 10 MB, a video up to 30 MB", async () => {
    const { p, c } = await setup();
    expect(await refused(() => up(p.desk, c.id, sized(JPEG, MAX_PHOTO_BYTES + 1)))).toEqual({ status: 413, message: "Photos can be at most 10 MB" });
    expect((await up(p.desk, c.id, sized(JPEG, MAX_PHOTO_BYTES))).kind).toBe("photo");
    expect((await up(p.desk, c.id, sized(MP4, MAX_VIDEO_BYTES))).kind).toBe("video");
  });

  it("the upload route stops reading after 30 MB", async () => {
    const { p, c } = await setup();
    const big = sized(MP4, MAX_VIDEO_BYTES + 1);
    const res = await as(p.desk, () =>
      uploadRoute(new Request(`http://localhost:3004/api/complaints/${c.id}/files`, { method: "POST", headers: { "content-type": "video/mp4", "content-length": String(big.length) }, body: big }), { params: Promise.resolve({ id: c.id }) }),
    );
    expect(res.status).toBe(413);
  });

  it("at most 5 photos and 1 video per complaint", async () => {
    const { p, c } = await setup();
    for (let i = 0; i < 5; i++) await up(p.desk, c.id, JPEG);
    expect(await refused(() => up(p.desk, c.id, PNG))).toEqual({ status: 409, message: "This complaint already has 5 photos" });
    await up(p.desk, c.id, MOV);
    expect(await refused(() => up(p.desk, c.id, MP4))).toEqual({ status: 409, message: "This complaint already has a video" });
  });

  it("six photos sent at the same moment still give five", async () => {
    const { p, c } = await setup();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => up(p.desk, c.id, JPEG)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect((await asOwner("select count(*)::int as n from complaint_box.files where complaint_id = $1", [c.id])).rows[0]).toEqual({ n: 5 });
  });
});

describe("the plan's storage limit", () => {
  it("an upload that would pass it is refused; under it is fine; another plant's files don't count", async () => {
    const { p, c } = await setup();
    platform.limits.set(p.tenantId, { complaint_box: { storage_mb: 1 } });
    await up(p.desk, c.id, sized(JPEG, 600 * 1024));
    expect(await refused(() => up(p.desk, c.id, sized(PNG, 500 * 1024)))).toEqual({ status: 413, message: "Storage full for your plan – ask PlantOps to extend it" });
    expect((await up(p.desk, c.id, sized(PNG, 400 * 1024))).kind).toBe("photo");
    const other = await setup();
    expect((await up(other.p.desk, other.c.id, sized(MP4, 5 * 1024 * 1024))).kind).toBe("video"); // no limit there
  });
});

describe("who may add them", () => {
  it("whoever logged it, or the owner; not another staff member, support or a store keeper", async () => {
    const { p, c } = await setup();
    expect((await up(p.owner, c.id, JPEG)).kind).toBe("photo");
    expect(await refused(() => up(p.staff, c.id, JPEG))).toEqual({ status: 403, message: "Only the person who logged this complaint (or the owner) can add its photos. Add a note instead." });
    expect(await refused(() => up(p.support, c.id, JPEG))).toEqual({ status: 403, message: "PlantOps support view is read-only" });
    expect((await refused(() => up(p.keeper, c.id, JPEG))).status).toBe(403);
  });

  it("only within 24 hours of logging", async () => {
    const { p, c } = await setup();
    const day = 24 * 60 * 60 * 1000;
    expect((await up(p.desk, c.id, JPEG, Date.now() + day - 60_000)).kind).toBe("photo");
    expect(await refused(() => up(p.desk, c.id, JPEG, Date.now() + day + 60_000))).toEqual({ status: 403, message: "Photos and video can only be added within 24 hours of logging. Add a note instead." });
    expect((await refused(() => up(p.owner, c.id, JPEG, Date.now() + day + 60_000))).status).toBe(403);
  });
});

describe("plant isolation", () => {
  it("nobody can add to or open another plant's complaint files", async () => {
    const a = await setup();
    const b = await setup();
    expect(await refused(() => up(b.p.owner, a.c.id, JPEG))).toEqual({ status: 404, message: "Complaint not found" });
    const f = await up(a.p.desk, a.c.id, JPEG);
    expect(await refused(() => readComplaintFile(b.p.owner, f.id))).toEqual({ status: 404, message: "File not found" });
    expect((await as(b.p.owner, () => download(new Request(`http://localhost:3004/files/${f.id}`), { params: Promise.resolve({ id: f.id }) }))).status).toBe(404);
    expect((await readComplaintFile(a.p.staff, f.id)).data.equals(JPEG)).toBe(true);
  });
});

describe("download and byte ranges", () => {
  const get = (u: CbUser, id: string, range?: string) =>
    as(u, () => download(new Request(`http://localhost:3004/files/${id}`, range ? { headers: { range } } : {}), { params: Promise.resolve({ id }) }));

  it("parses one range", () => {
    expect(parseRange("bytes=0-1", 10)).toEqual({ start: 0, end: 1 });
    expect(parseRange("bytes=5-", 10)).toEqual({ start: 5, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange("bytes=10-", 10)).toBe("unsatisfiable");
    expect(parseRange("bytes=5-2", 10)).toBe("unsatisfiable");
    expect(parseRange(null, 10)).toBeNull();
    expect(parseRange("bytes=0-1,4-5", 10)).toBeNull(); // several ranges: the whole file
  });

  it("whole file with Accept-Ranges; 206 for a range (iPhone video); 416 outside the file", async () => {
    const { p, c } = await setup();
    const f = await up(p.desk, c.id, MP4);
    const n = MP4.length;
    const whole = await get(p.owner, f.id);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await whole.arrayBuffer()).equals(MP4)).toBe(true);

    const first = await get(p.desk, f.id, "bytes=0-1");
    expect(first.status).toBe(206);
    expect(first.headers.get("content-range")).toBe(`bytes 0-1/${n}`);
    expect(first.headers.get("content-length")).toBe("2");
    expect([...Buffer.from(await first.arrayBuffer())]).toEqual([...MP4.subarray(0, 2)]);

    const rest = await get(p.desk, f.id, "bytes=5-");
    expect(rest.headers.get("content-range")).toBe(`bytes 5-${n - 1}/${n}`);
    expect(Buffer.from(await rest.arrayBuffer()).equals(MP4.subarray(5))).toBe(true);

    const tail = await get(p.desk, f.id, "bytes=-3");
    expect(Buffer.from(await tail.arrayBuffer()).equals(MP4.subarray(n - 3))).toBe(true);

    const outside = await get(p.desk, f.id, `bytes=${n}-`);
    expect(outside.status).toBe(416);
    expect(outside.headers.get("content-range")).toBe(`bytes */${n}`);
  });

  it("a photo gets a strict content policy; without a session 401", async () => {
    const { p, c } = await setup();
    const f = await up(p.desk, c.id, PNG);
    expect((await get(p.staff, f.id)).headers.get("content-security-policy")).toMatch(/default-src 'none'/);
    const spy = vi.spyOn(kit, "currentSession").mockResolvedValue(null);
    try {
      expect((await download(new Request(`http://localhost:3004/files/${f.id}`), { params: Promise.resolve({ id: f.id }) })).status).toBe(401);
    } finally {
      spy.mockRestore();
    }
  });

  it("PlantOps support can open a file, and it is logged for the owner", async () => {
    const { p, c } = await setup();
    const f = await up(p.desk, c.id, JPEG);
    expect((await get(p.support, f.id)).status).toBe(200);
    expect((await asOwner("select path from complaint_box.support_views where tenant_id = $1", [p.tenantId])).rows).toEqual([{ path: `/files/${f.id}` }]);
    expect((await get(p.keeper, f.id)).status).toBe(403);
  });

  it("an unknown or malformed file id is 404 (it simply doesn't exist)", async () => {
    const { p } = await setup();
    expect((await get(p.owner, randomUUID())).status).toBe(404);
    expect((await get(p.owner, "../etc/passwd")).status).toBe(404);
  });
});
