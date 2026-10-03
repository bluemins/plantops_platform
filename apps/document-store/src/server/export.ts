// The owner's export: every document with every version (CLAUDE.md: plants can export their data).
import { csv, csvTime } from "@plantops/module-kit/csv";
import { schema, withTenant } from "./db";
import { getDocument, listDocuments } from "./documents";
import { actorOf, requireOwner, type DocUser } from "./session";

export async function exportDocuments(user: DocUser) {
  requireOwner(user);
  const all = [...(await listDocuments(user, { filter: "all" })), ...(await listDocuments(user, { filter: "archived" }))];
  const rows: unknown[][] = [
    ["document_id", "status", "version", "kind", "name", "certificate_no", "issued_on", "expires_on", "authority", "support_contact", "responsible", "remark", "reason", "file_name", "file_type", "file_size_bytes", "entered_by", "entered_at"],
  ];
  for (const d of all) {
    const detail = await getDocument(user, d.id);
    for (const v of detail.versions) {
      rows.push([d.id, d.status, v.version, v.kind, v.name, v.certificate_no, v.issued_on, v.expires_on, v.authority, v.support_contact, d.responsible_name, v.remark, v.reason, v.file.original_name, v.file.content_type, v.file.size_bytes, v.entered_by_name, csvTime(v.entered_at)]);
    }
  }
  await withTenant(user.tenantId, (tx) => tx.insert(schema.auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action: "export.documents", details: { documents: all.length } }));
  return csv(rows);
}
