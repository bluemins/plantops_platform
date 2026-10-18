// The phone's location for a mark or the plant pin (B-04). A phone's first answer is often the rough network fix
// (±200-500 m, 1-2 km off), so we keep watching for up to 20 s and take the best reading, stopping early on good GPS.

/** A reading this good is used at once. */
export const GOOD_ACCURACY_M = 30;
/** The longest we wait for a better reading. */
export const WAIT_MS = 20_000;

export interface Reading {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * The most accurate reading within 20 s (or the first ±30 m one). Rejects only when there is no reading at all
 * (location blocked, switched off, or nothing in 20 s). `onReading` gets each accuracy, for the "±450 m" on the button.
 */
export function bestLocation(geo: Geolocation = navigator.geolocation, onReading?: (accuracy: number) => void): Promise<Reading> {
  return new Promise((resolve, reject) => {
    let best: Reading | null = null;
    let done = false;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      geo.clearWatch(id);
      if (best) resolve(best);
      else reject(err ?? new Error("No location"));
    };
    const id = geo.watchPosition(
      (pos) => {
        const r = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        onReading?.(r.accuracy);
        if (!best || r.accuracy < best.accuracy) best = r;
        if (r.accuracy <= GOOD_ACCURACY_M) finish();
      },
      (err) => finish(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: WAIT_MS },
    );
    const timer = setTimeout(() => finish(), WAIT_MS);
  });
}
