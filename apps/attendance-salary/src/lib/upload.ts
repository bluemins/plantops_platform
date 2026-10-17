"use client";
// Bill photos on the phone: picked, shrunk (longest side 1600 px, JPEG ~80%) and uploaded one by one. A copy of
// Complaint Box's helper, photos only (apps don't share code; packages/* do).

export type FileState = "waiting" | "uploading" | "done" | "failed";
/** A picked photo (already shrunk) and how its upload went. */
export type Pick = { key: string; blob: Blob | null; preview: string | null; state: FileState; error?: string };

export const MAX_PHOTOS = 3;
const LONGEST_SIDE = 1600;
const QUALITY = 0.8;
/** A key for each picked file. Not crypto.randomUUID(): that only exists on https pages (phones test on plain http). */
let picked = 0;
const nextKey = () => `pick-${++picked}`;

/** Photos are shrunk on the phone before upload: longest side 1600 px, JPEG ~80% (about 200–400 KB). */
export async function shrink(file: File): Promise<Blob> {
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // older browsers: decode through an <img> (it applies the photo's orientation itself)
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("unreadable"));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = "naturalWidth" in source ? source.naturalWidth : source.width;
  const h = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!w || !h) throw new Error("unreadable");
  const scale = Math.min(1, LONGEST_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("unreadable"))), "image/jpeg", QUALITY));
}

/** Picks photos: each is shrunk; one that can't be read is kept as a failed line with the reason. */
export async function photoPicks(list: File[]): Promise<Pick[]> {
  const out: Pick[] = [];
  for (const file of list) {
    try {
      const blob = await shrink(file);
      out.push({ key: nextKey(), blob, preview: URL.createObjectURL(blob), state: "waiting" });
    } catch {
      out.push({ key: nextKey(), blob: null, preview: null, state: "failed", error: "This photo could not be read" });
    }
  }
  return out;
}

/** Uploads every picked photo that isn't done yet, one after another, to `url` (raw body); each keeps its own state. */
export async function uploadPicks(url: string, list: Pick[], update: (key: string, change: Partial<Pick>) => void) {
  for (const p of list) {
    if (p.state === "done" || !p.blob) continue;
    update(p.key, { state: "uploading", error: undefined });
    let state: FileState = "failed";
    let error: string | undefined;
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": p.blob.type || "image/jpeg" }, body: p.blob });
      if (res.ok) state = "done";
      else error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status})`;
    } catch {
      error = "No connection. Check the internet and try again.";
    }
    update(p.key, { state, error });
  }
}
