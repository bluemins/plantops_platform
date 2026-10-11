// The shared upload checks: what counts as a video (MP4 / MOV by the "ftyp" box) and that HEIC / AVIF photos,
// which use the same box, are never taken for one. The storage drivers are tested in Document Store.
import { describe, expect, it } from "vitest";
import { sniffType, sniffVideo } from "../src/storage";

const ftyp = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(16)]);

describe("sniffVideo", () => {
  it.each([
    ["isom", "video/mp4"],
    ["mp42", "video/mp4"],
    ["mp41", "video/mp4"],
    ["avc1", "video/mp4"],
    ["M4V ", "video/mp4"],
    ["qt  ", "video/quicktime"],
  ])("brand %j -> %s", (brand, type) => {
    expect(sniffVideo(ftyp(brand))).toBe(type);
  });

  it.each(["heic", "heix", "mif1", "avif", "msf1", "crx "])("photo brand %j is not a video", (brand) => {
    expect(sniffVideo(ftyp(brand))).toBeNull();
  });

  it("anything without an ftyp box is not a video", () => {
    expect(sniffVideo(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffVideo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffVideo(Buffer.from("ftyp"))).toBeNull();
    expect(sniffVideo(Buffer.alloc(0))).toBeNull();
  });

  it("a video is never taken for a photo or PDF", () => {
    expect(sniffType(ftyp("isom"))).toBeNull();
  });
});
