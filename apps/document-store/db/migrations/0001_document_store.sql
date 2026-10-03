-- Phase 4: Document Store - the plant's licences and certificates, their files, renewal history and email
-- reminders. Runs as plantops_owner (owns the tables, never used by the app). The app connects as doc_app
-- (scripts/setup-module-db.sh): no BYPASSRLS, never the owner, only this schema.
--
-- * Every table holds tenant_id with ENABLE + FORCE row-level security and one tenant_isolation policy.
-- * History is APPEND-ONLY: a renewal or correction is a new document_versions row; files are never replaced or
--   deleted. doc_app has SELECT + INSERT, column UPDATE only where listed, and no DELETE anywhere.
-- * User ids (responsible person, who entered what) are plain references to the platform (no cross-schema key).

grant usage on schema document_store to doc_app;
revoke all on schema document_store from public;

-- ---------- uploaded files (the bytes live in file storage; this is the record of them) ----------
create table document_store.files (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  storage_key      text not null unique,
  original_name    text not null check (length(original_name) between 1 and 200),
  content_type     text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by      uuid not null,
  uploaded_by_name text not null,
  uploaded_at      timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------- documents and their versions ----------
create table document_store.documents (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  status              text not null default 'active' check (status in ('active', 'archived')),
  responsible_user_id uuid not null,
  responsible_name    text not null,
  created_by          uuid not null,
  created_by_name     text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id)
);

create table document_store.document_versions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  document_id     uuid not null,
  version         int not null check (version >= 1),
  kind            text not null check (kind in ('initial', 'renewal', 'correction')),
  name            text not null check (length(trim(name)) between 1 and 120),
  certificate_no  text check (length(certificate_no) <= 80),
  issued_on       date,
  expires_on      date,                 -- null = does not expire
  authority       text check (length(authority) <= 160),
  support_contact text check (length(support_contact) <= 300),
  file_id         uuid not null,
  remark          text check (length(remark) <= 500),
  reason          text,
  entered_by      uuid not null,
  entered_by_name text not null,
  entered_at      timestamptz not null default now(),
  check ((version = 1) = (kind = 'initial')),
  check (version = 1 or length(trim(coalesce(reason, ''))) >= 3),   -- a renewal / correction says why
  check (issued_on is null or expires_on is null or issued_on <= expires_on),
  unique (document_id, version),
  unique (tenant_id, id),
  foreign key (tenant_id, document_id) references document_store.documents (tenant_id, id),
  foreign key (tenant_id, file_id) references document_store.files (tenant_id, id)
);
create index document_versions_doc_idx on document_store.document_versions (document_id, version desc);

-- ---------- email reminders (outbox; one row per document version, stage and person - sent once) ----------
create table document_store.reminders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  document_id       uuid not null,
  version_id        uuid not null,
  stage             text not null check (stage ~ '^(d30|d7|d1|d0|expired_w[0-9]{1,3})$'),
  recipient_user_id uuid not null,
  recipient_name    text not null,
  email             text,
  status            text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error             text,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  unique (version_id, stage, recipient_user_id),
  foreign key (tenant_id, version_id) references document_store.document_versions (tenant_id, id)
);
create index reminders_doc_idx on document_store.reminders (document_id, created_at desc);

-- ---------- support views, audit ----------
create table document_store.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table document_store.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on document_store.audit_log (tenant_id, at);

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['files', 'documents', 'document_versions', 'reminders', 'support_views', 'audit_log'] loop
    execute format('alter table document_store.%I enable row level security', t);
    execute format('alter table document_store.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on document_store.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- the daily job lists plants (ids only), then works inside each plant ----------
create function document_store.doc_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from document_store.documents
$$;
revoke all on function document_store.doc_tenants() from public;
grant execute on function document_store.doc_tenants() to doc_app;

-- ---------- permissions for doc_app (never DELETE) ----------
grant select, insert on document_store.files, document_store.document_versions, document_store.support_views,
  document_store.audit_log to doc_app;
grant select, insert on document_store.documents to doc_app;
grant update (status, responsible_user_id, responsible_name, updated_at) on document_store.documents to doc_app;
grant select, insert on document_store.reminders to doc_app;
grant update (status, error, sent_at) on document_store.reminders to doc_app;
