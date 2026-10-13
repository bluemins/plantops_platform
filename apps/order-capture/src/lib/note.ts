// The order note typed with a new order (migration 0002): optional, at most 300 characters, fixed once saved.
// Line breaks are kept (a short address over two lines); spaces are joined and blank turns into "no note".
export const NOTE_MAX = 300;

export function cleanNote(s: string | undefined | null): string | null {
  const t = (s ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t || null;
}
