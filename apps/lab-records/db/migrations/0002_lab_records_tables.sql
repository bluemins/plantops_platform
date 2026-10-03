-- Phase 3: Lab Records tables (CLAUDE.md "Data rules", plan 2026-10-03). Runs as plantops_owner.
--
-- * Every table holds tenant_id, with ENABLE + FORCE row-level security and one tenant_isolation policy.
--   Without app.tenant_id set, the policy errors: nothing leaks (fails closed).
-- * Lab results are APPEND-ONLY, enforced here: lab_app has SELECT + INSERT only on entries,
--   entry_versions, entry_results, verifications, corrective_actions, batch_events, support_views and
--   audit_log. A correction is a new entry_versions row; a retest is a new entries row. No DELETE anywhere.
-- * batch_id / sku_id / user ids are plain references (no keys into another app's schema).

-- ---------- what each plant tests, and its limits ----------
create table lab_records.parameters (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  kind       text not null check (kind in ('daily', 'form1')),
  code       text not null check (code ~ '^[a-z0-9_]{1,40}$'),
  name       text not null check (length(trim(name)) between 1 and 80),
  unit       text check (length(unit) <= 20),
  limit_min  numeric,
  limit_max  numeric,
  active     boolean not null default true,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text not null,
  check (limit_min is null or limit_max is null or limit_min <= limit_max),
  unique (tenant_id, kind, code),
  unique (tenant_id, id)
);

-- ---------- batches (Lab Records owns the batch record) ----------
create table lab_records.batches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  batch_no        text not null check (batch_no ~ '^[A-Za-z0-9/_.-]{1,40}$'),
  production_date date not null,
  sku_id          uuid,
  product_name    text,
  status          text not null default 'pending' check (status in ('pending', 'on_hold', 'approved', 'rejected')),
  held_since      timestamptz,
  created_by      uuid not null,
  created_by_name text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
-- Batch numbers are unique per plant, ignoring upper/lower case.
create unique index batches_no_idx on lab_records.batches (tenant_id, upper(batch_no));
create index batches_status_idx on lab_records.batches (tenant_id, status, production_date desc);

create table lab_records.batch_events (
  id         bigint generated always as identity primary key,
  tenant_id  uuid not null,
  batch_id   uuid not null,
  event      text not null check (event in ('created', 'held', 'released', 'approved', 'rejected')),
  by_user    uuid,            -- null = the system (e.g. automatic hold on a failed test)
  by_name    text not null,
  note       text,
  entry_id   uuid,
  at         timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references lab_records.batches (tenant_id, id)
);
create index batch_events_batch_idx on lab_records.batch_events (batch_id, at);

-- ---------- lab entries: daily tests and FSSAI Forms 1-4, versioned ----------
create table lab_records.entries (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  form       text not null check (form in ('daily', 'form1', 'form2', 'form3', 'form4')),
  batch_id   uuid,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  check (form not in ('form1', 'form2') or batch_id is not null),
  unique (tenant_id, id),
  foreign key (tenant_id, batch_id) references lab_records.batches (tenant_id, id)
);
create index entries_batch_idx on lab_records.entries (tenant_id, batch_id);
create index entries_form_idx on lab_records.entries (tenant_id, form, created_at desc);

create table lab_records.entry_versions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  entry_id        uuid not null,
  version         int not null check (version >= 1),
  data            jsonb not null default '{}',
  reason          text,
  verdict         text not null check (verdict in ('pass', 'fail', 'none')),
  tested_at       timestamptz not null,
  entered_by      uuid not null,
  entered_by_name text not null,   -- the "Sign": name as it was when the entry was made
  entered_at      timestamptz not null default now(),
  -- a correction always says why
  check (version = 1 or length(trim(coalesce(reason, ''))) >= 3),
  unique (entry_id, version),
  unique (tenant_id, id),
  foreign key (tenant_id, entry_id) references lab_records.entries (tenant_id, id)
);

create table lab_records.entry_results (
  tenant_id      uuid not null,
  version_id     uuid not null,
  parameter_id   uuid not null,
  parameter_name text not null,    -- as printed at the time
  unit           text,
  value          numeric not null,
  limit_min      numeric,          -- the limit that applied when tested: later limit changes never alter it
  limit_max      numeric,
  verdict        text not null check (verdict in ('pass', 'fail', 'none')),
  primary key (version_id, parameter_id),
  foreign key (tenant_id, version_id) references lab_records.entry_versions (tenant_id, id),
  foreign key (tenant_id, parameter_id) references lab_records.parameters (tenant_id, id)
);

create table lab_records.verifications (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  version_id       uuid not null unique,
  verified_by      uuid not null,
  verified_by_name text not null,  -- "Verified By"
  verified_at      timestamptz not null default now(),
  foreign key (tenant_id, version_id) references lab_records.entry_versions (tenant_id, id)
);

create table lab_records.corrective_actions (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  batch_id  uuid not null,
  entry_id  uuid,
  note      text not null check (length(trim(note)) >= 5),
  by_user   uuid not null,
  by_name   text not null,
  at        timestamptz not null default now(),
  foreign key (tenant_id, batch_id) references lab_records.batches (tenant_id, id)
);

-- ---------- WhatsApp outbox, support views, audit ----------
create table lab_records.alerts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  kind           text not null,
  batch_id       uuid,
  recipient_name text not null,
  phone          text,
  message        text not null,
  status         text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  error          text,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index alerts_pending_idx on lab_records.alerts (status, created_at);

create table lab_records.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table lab_records.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on lab_records.audit_log (tenant_id, at);

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['parameters', 'batches', 'batch_events', 'entries', 'entry_versions', 'entry_results',
                           'verifications', 'corrective_actions', 'alerts', 'support_views', 'audit_log'] loop
    execute format('alter table lab_records.%I enable row level security', t);
    execute format('alter table lab_records.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on lab_records.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- permissions for lab_app (never DELETE; UPDATE only where listed) ----------
grant select, insert on lab_records.entries, lab_records.entry_versions, lab_records.entry_results,
  lab_records.verifications, lab_records.corrective_actions, lab_records.batch_events,
  lab_records.support_views, lab_records.audit_log to lab_app;

grant select, insert on lab_records.parameters to lab_app;
grant update (name, unit, limit_min, limit_max, active, sort, updated_at, updated_by) on lab_records.parameters to lab_app;

grant select, insert on lab_records.batches to lab_app;
grant update (status, held_since, updated_at) on lab_records.batches to lab_app;

grant select, insert on lab_records.alerts to lab_app;
grant update (status, error, sent_at) on lab_records.alerts to lab_app;
