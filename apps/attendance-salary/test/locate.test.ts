// B-04: wait for a good GPS reading instead of taking the phone's first (often rough) location.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bestLocation, GOOD_ACCURACY_M, WAIT_MS } from "@/lib/locate";

type Success = (p: GeolocationPosition) => void;
type Failure = (e: GeolocationPositionError) => void;

/** A phone's location service that the test drives by hand. */
function fakeGeo() {
  let ok: Success = () => {};
  let fail: Failure = () => {};
  const cleared: number[] = [];
  const geo = {
    options: null as PositionOptions | null,
    watchPosition(s: Success, f: Failure, o: PositionOptions) {
      ok = s;
      fail = f;
      geo.options = o;
      return 7;
    },
    clearWatch: (id: number) => cleared.push(id),
  };
  const reading = (accuracy: number, lat = 20.3) => ok({ coords: { latitude: lat, longitude: 85.8, accuracy } } as GeolocationPosition);
  const deny = () => fail({ code: 1, message: "denied" } as GeolocationPositionError);
  return { geo: geo as unknown as Geolocation & { options: PositionOptions }, reading, deny, cleared };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("bestLocation", () => {
  it("asks for GPS, never a cached reading", () => {
    const f = fakeGeo();
    void bestLocation(f.geo);
    expect(f.geo.options).toMatchObject({ enableHighAccuracy: true, maximumAge: 0 });
  });

  it("answers at once with a good reading (±30 m or better), and stops watching", async () => {
    const f = fakeGeo();
    const seen: number[] = [];
    const p = bestLocation(f.geo, (acc) => seen.push(acc));
    f.reading(450);
    f.reading(GOOD_ACCURACY_M);
    await expect(p).resolves.toEqual({ lat: 20.3, lng: 85.8, accuracy: GOOD_ACCURACY_M });
    expect(seen).toEqual([450, 30]);
    expect(f.cleared).toEqual([7]);
  });

  it("without a good reading: the best one after 20 s", async () => {
    const f = fakeGeo();
    const p = bestLocation(f.geo);
    f.reading(450, 1);
    f.reading(120, 2);
    f.reading(300, 3);
    vi.advanceTimersByTime(WAIT_MS);
    await expect(p).resolves.toEqual({ lat: 2, lng: 85.8, accuracy: 120 });
    expect(f.cleared).toEqual([7]);
  });

  it("no reading at all in 20 s: refused (no location)", async () => {
    const f = fakeGeo();
    const p = bestLocation(f.geo);
    vi.advanceTimersByTime(WAIT_MS);
    await expect(p).rejects.toThrow();
    expect(f.cleared).toEqual([7]);
  });

  it("location blocked: refused at once, unless a reading already came", async () => {
    const f = fakeGeo();
    const p = bestLocation(f.geo);
    f.deny();
    await expect(p).rejects.toThrow();
    expect(f.cleared).toEqual([7]);

    const g = fakeGeo();
    const q = bestLocation(g.geo);
    g.reading(200);
    g.deny(); // e.g. GPS timed out after a rough fix: use what we have
    await expect(q).resolves.toMatchObject({ accuracy: 200 });
  });
});
