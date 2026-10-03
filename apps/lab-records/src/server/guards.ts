// Who may do what in Lab Records (plan §2). Checked on the server for every action.
import { forbidden } from "./http";
import type { LabUser } from "./session";

/** Create batches, enter tests and corrections: lab technician or lab lead (the owner only views). */
export function requireEnter(user: LabUser) {
  if (user.isSupport) throw forbidden("PlantOps support view is read-only");
  if (!user.canEnter) throw forbidden("Only lab staff can enter test data");
}

/** Approve, release holds, verify, set limits: plant owner or lab lead. */
export function requireApprover(user: LabUser) {
  if (user.isSupport) throw forbidden("PlantOps support view is read-only");
  if (!user.canApprove) throw forbidden("Only the plant owner or a lab lead can do this");
}

export const actorOf = (user: LabUser) => `user:${user.userId}`;
