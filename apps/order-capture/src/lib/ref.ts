/** An order's reference as people see it: O-0001, O-0042, … O-10000 (stored as a number, one series per plant). */
export const formatRef = (n: number) => `O-${String(n).padStart(4, "0")}`;
