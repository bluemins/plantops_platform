// The installed app in each plant's own look: signed links, the plant's name / colour / logo icon, PlantOps otherwise,
// and one plant's link never showing another plant's logo.
import { beforeAll, describe, expect, it } from "vitest";
import { GET as plantOpsManifest } from "@/app/manifest.webmanifest/route";
import { GET as plantManifest } from "@/app/plant-app/[token]/manifest.webmanifest/route";
import { GET as plantIcon } from "@/app/plant-app/[token]/icon/[size]/route";
import { appToken, imageSize, plantApp, readAppToken } from "@/server/app-icon";
import { asOwner, makePlant } from "./helpers";

// A real 1x1 PNG (as in business.test.ts)
const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);

let A: Awaited<ReturnType<typeof makePlant>>;
let B: Awaited<ReturnType<typeof makePlant>>;

async function setProfile(tenantId: string, logo: Buffer | null, type: string | null, color: string | null = null) {
  await asOwner(
    `insert into platform.tenant_profiles (tenant_id, logo, logo_type, logo_updated_at, brand_color, updated_by) values ($1, $2, $3, case when $2::bytea is null then null else now() end, $4, 'test')
     on conflict (tenant_id) do update set logo = excluded.logo, logo_type = excluded.logo_type, logo_updated_at = excluded.logo_updated_at, brand_color = excluded.brand_color`,
    [tenantId, logo, type, color],
  );
}
const tokenOf = async (tenantId: string) => appToken(tenantId, (await plantApp(tenantId))!.logoVersion);
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never;
const req = () => new Request("http://localhost/x");

beforeAll(async () => {
  A = await makePlant();
  B = await makePlant();
});

describe("signed links", () => {
  it("a link the platform made is read back; a changed plant id, version or signature is not", () => {
    const t = appToken(A.tenantId, 123);
    expect(readAppToken(t)).toBe(A.tenantId);
    const [id, v, sig] = t.split(".");
    expect(readAppToken(`${B.tenantId}.${v}.${sig}`)).toBeNull();
    expect(readAppToken(`${id}.124.${sig}`)).toBeNull();
    // change the FIRST character: the last one of a base64url HMAC carries only 4 bits, so "x" there was sometimes
    // read back as the same signature (a 1-in-16 flaky test)
    expect(readAppToken(`${id}.${v}.${sig![0] === "A" ? "B" : "A"}${sig!.slice(1)}`)).toBeNull();
    for (const bad of ["", "x", `${id}.${v}`, `${t}.more`, `not-a-uuid.1.${sig}`]) expect(readAppToken(bad)).toBeNull();
  });
});

describe("the install details (manifest)", () => {
  it("PlantOps by default", async () => {
    const res = plantOpsManifest();
    expect(res.headers.get("content-type")).toBe("application/manifest+json");
    const m = await res.json();
    expect(m).toMatchObject({ name: "PlantOps", short_name: "PlantOps", start_url: "/home", display: "standalone", theme_color: "#1d4ed8" });
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(["/icon-192.png", "/icon-512.png", "/icon-512.png"]);
  });

  it("a plant's: its name, brand colour and its own icon links", async () => {
    await setProfile(A.tenantId, PNG_1x1, "image/png", "#0e7490");
    const t = await tokenOf(A.tenantId);
    const res = await plantManifest(req(), params({ token: t }));
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: `Plant ${A.code}`, theme_color: "#0e7490", id: "/home" });
    expect(m.icons).toEqual([
      { src: `/plant-app/${t}/icon/192`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `/plant-app/${t}/icon/512`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `/plant-app/${t}/icon/512m`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("a forged link: 404", async () => {
    expect((await plantManifest(req(), params({ token: `${A.tenantId}.0.forgedforgedforgedforgedforged00` }))).status).toBe(404);
  });
});

describe("the icon", () => {
  it("the plant's logo drawn as a square PNG of the asked size", async () => {
    await setProfile(A.tenantId, PNG_1x1, "image/png");
    const t = await tokenOf(A.tenantId);
    for (const [size, px] of [["180", 180], ["192", 192], ["512", 512], ["512m", 512]] as const) {
      const res = await plantIcon(req(), params({ token: t, size }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(imageSize(Buffer.from(await res.arrayBuffer()), "image/png")).toEqual({ width: px, height: px });
    }
  });

  it("no logo, or a WebP logo: the PlantOps icon", async () => {
    for (const [logo, type] of [[null, null], [WEBP, "image/webp"]] as const) {
      await setProfile(B.tenantId, logo, type);
      const t = await tokenOf(B.tenantId);
      const res = await plantIcon(req(), params({ token: t, size: "512" }));
      expect([res.status, res.headers.get("location")]).toEqual([307, "/icon-512.png"]);
      expect((await plantIcon(req(), params({ token: t, size: "180" }))).headers.get("location")).toBe("/icon-192.png");
    }
  });

  it("a new logo makes a new link", async () => {
    await setProfile(A.tenantId, PNG_1x1, "image/png");
    const before = await tokenOf(A.tenantId);
    await asOwner("update platform.tenant_profiles set logo_updated_at = logo_updated_at + interval '1 second' where tenant_id = $1", [A.tenantId]);
    expect(await tokenOf(A.tenantId)).not.toBe(before);
  });

  it("a forged link or an unknown size: 404; plant B's link never shows plant A's logo", async () => {
    await setProfile(A.tenantId, PNG_1x1, "image/png");
    await setProfile(B.tenantId, null, null);
    const a = await tokenOf(A.tenantId);
    const [, v, sig] = a.split(".");
    expect((await plantIcon(req(), params({ token: `${B.tenantId}.${v}.${sig}`, size: "192" }))).status).toBe(404);
    expect((await plantIcon(req(), params({ token: a, size: "64" }))).status).toBe(404);
    expect((await plantIcon(req(), params({ token: await tokenOf(B.tenantId), size: "192" }))).status).toBe(307);
  });
});

describe("image sizes from the file header", () => {
  it("PNG and JPEG (the size is in the SOF block, after other blocks)", () => {
    expect(imageSize(PNG_1x1, "image/png")).toEqual({ width: 1, height: 1 });
    // SOI, an APP0 block of 16 bytes, then SOF0 with height 200 and width 300
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xc8, 0x01, 0x2c, 0x03, 0, 0, 0, 0, 0, 0]);
    expect(imageSize(jpeg, "image/jpeg")).toEqual({ width: 300, height: 200 });
    expect(imageSize(Buffer.from([0xff, 0xd8, 0x00]), "image/jpeg")).toBeNull();
  });
});
