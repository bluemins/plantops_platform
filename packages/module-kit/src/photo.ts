// Shrinking a photo on the phone before it is sent (browser only): Complaint Box's complaint photos and Job
// applications' photos of a paper CV. Longest side 1600 px, JPEG ~80% (about 200–400 KB). An iPhone HEIC photo is
// decoded by the phone itself and comes out as a JPEG; one the browser can't read throws "unreadable".
const LONGEST_SIDE = 1600;
const QUALITY = 0.8;

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
