// The owner's export: every document with every version (CLAUDE.md: plants can export their data).
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { csv, csvTime } from "@plantops/module-kit/csv";
import { schema, withTenant } from "./db";
import { getDocument, listDocuments, readFile } from "./documents";
import { actorOf, requireOwner, type DocUser } from "./session";

async function allDocuments(user: DocUser) {
  requireOwner(user);
  const rows = [...(await listDocuments(user, { filter: "all" })), ...(await listDocuments(user, { filter: "archived" }))];
  return Promise.all(rows.map((d) => getDocument(user, d.id)));
}

function documentsCsv(all: Awaited<ReturnType<typeof allDocuments>>) {
  const rows: unknown[][] = [
    ["document_id", "status", "version", "kind", "name", "certificate_no", "issued_on", "expires_on", "authority", "support_contact", "responsible", "remark", "reason", "file_name", "file_type", "file_size_bytes", "entered_by", "entered_at"],
  ];
  for (const d of all) {
    for (const v of d.versions) {
      rows.push([d.id, d.status, v.version, v.kind, v.name, v.certificate_no, v.issued_on, v.expires_on, v.authority, v.support_contact, d.responsible_name, v.remark, v.reason, v.file.original_name, v.file.content_type, v.file.size_bytes, v.entered_by_name, csvTime(v.entered_at)]);
    }
  }
  return csv(rows);
}

async function auditExport(user: DocUser, action: string, details: Record<string, number>) {
  await withTenant(user.tenantId, (tx) => tx.insert(schema.auditLog).values({ tenantId: user.tenantId, actor: actorOf(user), action, details }));
}

export async function exportDocuments(user: DocUser) {
  const all = await allDocuments(user);
  await auditExport(user, "export.documents", { documents: all.length });
  return documentsCsv(all);
}

const safeEntryName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+$/, "document").slice(0, 180) || "document";

/** Owner-only streaming ZIP of the CSV manifest and every document version's original file. */
export async function exportDocumentBundle(user: DocUser) {
  const all = await allDocuments(user);
  const fileCount = all.reduce((count, doc) => count + doc.versions.length, 0);
  await auditExport(user, "export.documents_bundle", { documents: all.length, files: fileCount });

  const output = new PassThrough();
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on("error", (error) => output.destroy(error));
  archive.pipe(output);
  archive.append(documentsCsv(all), { name: "documents.csv" });

  void (async () => {
    try {
      for (const doc of all) {
        for (const version of doc.versions) {
          const { data } = await readFile(user, version.file.id);
          const fileName = safeEntryName(version.file.original_name);
          archive.append(data, { name: `documents/${doc.id}/v${version.version}-${fileName}` });
        }
      }
      await archive.finalize();
    } catch (error) {
      archive.destroy(error as Error);
      output.destroy(error as Error);
    }
  })();

  return { stream: output, documents: all.length, files: fileCount };
}
