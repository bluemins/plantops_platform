"use client";
// Picking, shrinking and uploading photos / a video on the phone: shared by "Log a complaint" and "Add note".
// The shrinking itself is shared with Job applications (packages/module-kit/src/photo.ts).
import { shrink } from "@plantops/module-kit/photo";

export { shrink };

export type FileState = "waiting" | "uploading" | "done" | "failed";
/** A picked photo (already shrunk) or the video, and how its upload went. */
export type Pick = { key: string; kind: "photo" | "video"; blob: Blob | null; preview: string | null; state: FileState; error?: string };

export const MAX_PHOTOS = 5;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
/** A key for each picked file. Not crypto.randomUUID(): that only exists on https pages, and phones test on plain http (pnpm dev:lan). */
let picked = 0;
export const nextKey = () => `pick-${++picked}`;

/** Picks a set of photos: each is shrunk; one that can't be read is kept as a failed line with the reason. */
export async function photoPicks(list: File[]): Promise<Pick[]> {
  const out: Pick[] = [];
  for (const file of list) {
    try {
      const blob = await shrink(file);
      out.push({ key: nextKey(), kind: "photo", blob, preview: URL.createObjectURL(blob), state: "waiting" });
    } catch {
      out.push({ key: nextKey(), kind: "photo", blob: null, preview: null, state: "failed", error: "This photo could not be read" });
    }
  }
  return out;
}

/**
 * Uploads every picked file that isn't done yet, one after another, to `url` (raw body). Each keeps its own state,
 * reported through `update`, so the screen can say exactly which ones failed and offer Try again.
 */
export async function uploadPicks(url: string, list: Pick[], update: (key: string, change: Partial<Pick>) => void) {
  for (const p of list) {
    if (p.state === "done" || !p.blob) continue;
    update(p.key, { state: "uploading", error: undefined });
    let state: FileState = "failed";
    let error: string | undefined;
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": p.blob.type || "application/octet-stream" }, body: p.blob });
      if (res.ok) state = "done";
      else error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `Upload failed (${res.status})`;
    } catch {
      error = "No connection. Check the internet and try again.";
    }
    update(p.key, { state, error });
  }
}
