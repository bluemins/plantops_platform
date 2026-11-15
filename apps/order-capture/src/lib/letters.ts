/** The letter strip on the customer list: A–Z, and "#" for every name that doesn't start with A–Z (numbers, others). */
export const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"] as const;
export type Letter = (typeof LETTERS)[number];

/** A letter from the address (`?l=b` → "B"); anything else = no letter picked. */
export const asLetter = (v: string): Letter | undefined => {
  const up = v.toUpperCase();
  return (LETTERS as readonly string[]).includes(up) ? (up as Letter) : undefined;
};
