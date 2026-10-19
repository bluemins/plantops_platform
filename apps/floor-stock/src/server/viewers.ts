// Stock viewers (v0.27.0, owner 2026-10-19; docs/VIEW_ROLES_PHASE_PLAN.md): people with the platform role "Stock
// viewer" open Floor Stock read-only and see only the sections the owner picked for each of them. The owner picks on
// Sections & items ("Who sees what"); every change is audited. Every read of stock data asks visibleSections() and
// leaves out other sections on the SERVER, so a viewer can never see them by changing a link.
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { viewOnlyIn } from "@plantops/types";
import { schema, withTenant, type StockTx } from "./db";
import { badRequest, notFound } from "./http";
import { kit } from "./kit";
import { actorOf, requireOwner, type StockUser } from "./session";

const { auditLog, sections, viewerSections } = schema;

/** The sections a viewer may see; null = no limit (owner, store keeper, support). */
export async function visibleSections(tx: StockTx, user: StockUser): Promise<Set<string> | null> {
  if (!user.isViewer) return null;
  const rows = await tx
    .select({ id: viewerSections.sectionId })
    .from(viewerSections)
    .where(and(eq(viewerSections.tenantId, user.tenantId), eq(viewerSections.userId, user.userId), eq(viewerSections.status, "on")));
  return new Set(rows.map((r) => r.id));
}

/** Every viewer's sections in one plant (for their own alert versions). */
export async function viewerSectionMap(tx: StockTx, tenantId: string): Promise<Map<string, Set<string>>> {
  const rows = await tx
    .select({ userId: viewerSections.userId, sectionId: viewerSections.sectionId })
    .from(viewerSections)
    .where(and(eq(viewerSections.tenantId, tenantId), eq(viewerSections.status, "on")));
  const map = new Map<string, Set<string>>();
  for (const r of rows) map.set(r.userId, (map.get(r.userId) ?? new Set()).add(r.sectionId));
  return map;
}

export interface ViewerView {
  user_id: string;
  name: string;
  section_ids: string[];
}

/** The plant's Stock viewers (from PlantOps) and the sections each sees. Owner only. null = PlantOps unreachable. */
export async function listViewers(user: StockUser): Promise<ViewerView[] | null> {
  requireOwner(user);
  const contacts = await kit.contacts(user.tenantId);
  if (!contacts) return null;
  const viewers = contacts.filter((c) => viewOnlyIn(c.roles, "floor_stock"));
  const map = await withTenant(user.tenantId, (tx) => viewerSectionMap(tx, user.tenantId));
  return viewers.map((v) => ({ user_id: v.user_id, name: v.display_name, section_ids: [...(map.get(v.user_id) ?? [])] }));
}

export const ViewerSectionsInput = z.object({ section_ids: z.array(z.uuid()).max(200) });

/** The owner sets which sections one Stock viewer sees (the whole list; the rest are switched off). */
export async function setViewerSections(user: StockUser, viewerId: string, input: z.infer<typeof ViewerSectionsInput>) {
  requireOwner(user, "Only the plant owner can choose what a Stock viewer sees");
  const contacts = await kit.contacts(user.tenantId);
  if (!contacts) throw badRequest("PlantOps could not be reached right now. Please try again in a minute.");
  const viewer = contacts.find((c) => c.user_id === viewerId && viewOnlyIn(c.roles, "floor_stock"));
  if (!viewer) throw notFound("This person is not a Stock viewer of this plant");
  const wanted = new Set(input.section_ids);
  return withTenant(user.tenantId, async (tx) => {
    const secs = await tx.select().from(sections).where(eq(sections.tenantId, user.tenantId)).orderBy(asc(sections.sortOrder), asc(sections.createdAt));
    const byId = new Map(secs.map((s) => [s.id, s]));
    for (const id of wanted) if (!byId.has(id)) throw badRequest("That section is not one of this plant's sections");
    const current = await tx
      .select()
      .from(viewerSections)
      .where(and(eq(viewerSections.tenantId, user.tenantId), eq(viewerSections.userId, viewerId)))
      .for("update");
    const before = new Set(current.filter((r) => r.status === "on").map((r) => r.sectionId));
    const stamp = { changedBy: user.userId, changedByName: user.name, changedAt: new Date() };
    for (const r of current) {
      const status = wanted.has(r.sectionId) ? "on" : "off";
      if (r.status !== status) await tx.update(viewerSections).set({ status, ...stamp }).where(eq(viewerSections.id, r.id));
    }
    const missing = [...wanted].filter((id) => !current.some((r) => r.sectionId === id));
    if (missing.length) await tx.insert(viewerSections).values(missing.map((sectionId) => ({ tenantId: user.tenantId, userId: viewerId, sectionId, status: "on" as const, ...stamp })));

    const names = (ids: Iterable<string>) => secs.filter((s) => [...ids].includes(s.id)).map((s) => s.name);
    const changed = before.size !== wanted.size || [...wanted].some((id) => !before.has(id));
    if (changed) {
      await tx.insert(auditLog).values({
        tenantId: user.tenantId,
        actor: actorOf(user),
        action: "setup.viewer_sections",
        target: viewerId,
        details: { by: user.name, name: viewer.display_name, from: names(before), to: names(wanted) },
      });
    }
    return { user_id: viewerId, section_ids: secs.filter((s) => wanted.has(s.id)).map((s) => s.id), changed };
  });
}

/** Keep only the given sections (null = all). */
export const inSections = <T extends { id: string }>(list: T[], allowed: Set<string> | null) => (allowed ? list.filter((s) => allowed.has(s.id)) : list);

