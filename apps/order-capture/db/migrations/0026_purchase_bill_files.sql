-- Bill copy on purchase bills (owner, 2026-11-20; mock-up https://claude.ai/artifact/Ep8fsTZwj4rzcECa4yiKs5).
-- The owner or Accounts attach the vendor's bill as a PDF or photos, on "+ Purchase bill" or later on the bill's page
-- (Zoho-imported bills too). Seen by the owner, Accounts and PlantOps support (logged); never by Store keepers (the
-- bill shows prices). A copy is never changed or deleted: a wrong file stays and the right one is added next to it.
-- The file itself lives in Sales' own storage folder (ORDER_STORAGE_DIR) or bucket, under a random key; this row is the
-- only way to reach it. One new table; order_app gets SELECT + INSERT only. Older code ignores it.
create table order_capture.purchase_bill_files (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  bill_id         uuid not null,
  storage_key     text not null unique,
  file_name       text check (file_name is null or length(file_name) between 1 and 200),
  content_type    text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes      int not null check (size_bytes between 1 and 10485760),                 -- 10 MB
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by      uuid not null,
  created_by_name text not null check (length(trim(created_by_name)) between 1 and 100),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, bill_id) references order_capture.purchase_bills (tenant_id, id)
);
create index purchase_bill_files_bill on order_capture.purchase_bill_files (tenant_id, bill_id, created_at);

alter table order_capture.purchase_bill_files enable row level security;
alter table order_capture.purchase_bill_files force row level security;
create policy tenant_isolation on order_capture.purchase_bill_files
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.purchase_bill_files to order_app;
