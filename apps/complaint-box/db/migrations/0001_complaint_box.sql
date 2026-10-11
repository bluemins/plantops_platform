-- Complaint Box: customer complaints logged by plant staff (photos / video), followed up and resolved by the owner.
-- Plan: docs/COMPLAINT_BOX_PHASE_PLAN.md. Runs as plantops_owner; the app connects as complaint_app (no BYPASSRLS,
-- never the owner, only this schema).
-- * Every table holds tenant_id with ENABLE + FORCE row-level security and one tenant_isolation policy.
-- * Nothing is ever deleted: complaint_app has no DELETE anywhere. A complaint's details are never changed (only its
--   status); history, files and the audit log are append-only. Items are switched off, never deleted.
-- * sku_id and user ids are plain references to the platform (no cross-schema key).

grant usage on schema complaint_box to complaint_app;
revoke all on schema complaint_box from public;

-- ---------- the plant's item list (product or equipment complained about) ----------
create table complaint_box.items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  name            text not null check (length(trim(name)) between 1 and 60),
  sku_id          uuid,                                   -- the platform product, if the item is one
  sort_order      int not null default 0,
  status          text not null default 'active' check (status in ('active', 'off')),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
-- two active items can't share a name; a switched-off one may (it can be replaced)
create unique index items_active_name_uq on complaint_box.items (tenant_id, lower(trim(name))) where status = 'active';

-- ---------- complaints (details locked on save; only the status moves) ----------
create table complaint_box.complaints (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  ref_no            int not null check (ref_no >= 1),                   -- shown as C-0001
  customer_name     text not null check (length(trim(customer_name)) between 2 and 100),
  phone_typed       text not null check (length(phone_typed) between 1 and 30),
  phone             text not null check (phone ~ '^[6-9][0-9]{9}$'),    -- normalised Indian mobile
  place             text not null check (length(trim(place)) between 2 and 200),
  item_id           uuid not null,
  item_name         text not null,                                      -- as it was when logged
  batch_text        text check (batch_text is null or length(batch_text) <= 60),
  description       text not null check (length(trim(description)) between 10 and 2000),
  reported_by       uuid not null,
  reported_by_name  text not null,
  created_at        timestamptz not null default now(),
  status            text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  status_changed_at timestamptz not null default now(),
  unique (tenant_id, ref_no),
  unique (tenant_id, id),
  foreign key (tenant_id, item_id) references complaint_box.items (tenant_id, id)
);
create index complaints_list_idx on complaint_box.complaints (tenant_id, created_at desc);
create index complaints_status_idx on complaint_box.complaints (tenant_id, status);

-- ---------- history: status changes and notes (append-only) ----------
create table complaint_box.complaint_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  complaint_id    uuid not null,
  kind            text not null check (kind in ('in_progress', 'resolved', 'reopened', 'note')),
  text            text check (text is null or length(text) <= 2000),
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  -- resolving needs a resolution note, reopening a reason
  check (kind not in ('resolved', 'reopened') or length(trim(coalesce(text, ''))) >= 3),
  unique (tenant_id, id),
  foreign key (tenant_id, complaint_id) references complaint_box.complaints (tenant_id, id)
);
create index complaint_events_idx on complaint_box.complaint_events (complaint_id, created_at);

-- ---------- photos and video (files on disk / S3; never replaced or deleted) ----------
create table complaint_box.files (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  complaint_id     uuid not null,
  event_id         uuid,                                   -- set when the photo belongs to a note
  kind             text not null check (kind in ('photo', 'video')),
  content_type     text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime')),
  size_bytes       bigint not null check (size_bytes > 0 and size_bytes <= 31457280),   -- 30 MB
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key      text not null unique,
  uploaded_by      uuid not null,
  uploaded_by_name text not null,
  uploaded_at      timestamptz not null default now(),
  check ((kind = 'photo') = (content_type like 'image/%')),
  check (kind = 'video' or size_bytes <= 10485760),                                       -- photos 10 MB
  foreign key (tenant_id, complaint_id) references complaint_box.complaints (tenant_id, id),
  foreign key (tenant_id, event_id) references complaint_box.complaint_events (tenant_id, id)
);
create index files_complaint_idx on complaint_box.files (complaint_id);

-- ---------- support views, audit (item changes, CSV exports) ----------
create table complaint_box.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table complaint_box.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on complaint_box.audit_log (tenant_id, at);

-- ---------- notifications that couldn't reach the platform (N4 outbox, as in the other modules) ----------
create table complaint_box.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  input       jsonb not null,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  given_up_at timestamptz
);
create index notification_outbox_waiting on complaint_box.notification_outbox (tenant_id, created_at)
  where sent_at is null and given_up_at is null;

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['items', 'complaints', 'complaint_events', 'files', 'support_views', 'audit_log',
                           'notification_outbox'] loop
    execute format('alter table complaint_box.%I enable row level security', t);
    execute format('alter table complaint_box.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on complaint_box.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- the daily job lists plants (ids only), then works inside each plant ----------
create function complaint_box.outbox_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from complaint_box.notification_outbox where sent_at is null and given_up_at is null
$$;
revoke all on function complaint_box.outbox_tenants() from public;
grant execute on function complaint_box.outbox_tenants() to complaint_app;

create function complaint_box.open_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from complaint_box.complaints where status in ('open', 'in_progress')
$$;
revoke all on function complaint_box.open_tenants() from public;
grant execute on function complaint_box.open_tenants() to complaint_app;

-- ---------- permissions for complaint_app (never DELETE) ----------
grant select, insert on complaint_box.items, complaint_box.complaints, complaint_box.complaint_events,
  complaint_box.files, complaint_box.support_views, complaint_box.audit_log, complaint_box.notification_outbox
  to complaint_app;
grant update (name, sort_order, status, updated_at) on complaint_box.items to complaint_app;
grant update (status, status_changed_at) on complaint_box.complaints to complaint_app;
grant update (attempts, last_error, sent_at, given_up_at) on complaint_box.notification_outbox to complaint_app;
