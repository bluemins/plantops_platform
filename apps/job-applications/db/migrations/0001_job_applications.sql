-- Job applications: job seekers send name, phone, place and a resume through a public page; the plant's owner and
-- HR desk call them and track the outcome. Plan: docs/JOB_APPLICATIONS_PHASE_PLAN.md. Runs as plantops_owner; the
-- app connects as jobs_app (no BYPASSRLS, never the owner, only this schema).
-- * Every table holds tenant_id with ENABLE + FORCE row-level security and one tenant_isolation policy.
-- * jobs_app has NO DELETE anywhere. Applications are personal data kept 12 months (the applicant's consent): they are
--   removed only by the security-definer functions at the end (12-month purge, owner's "Remove now"), the first
--   deletes in any PlantOps module (owner, 2026-10-17). Openings are switched off, never deleted.
-- * User ids are plain references to the platform (no cross-schema key).

grant usage on schema job_applications to jobs_app;
revoke all on schema job_applications from public;

-- ---------- the plant's openings (shown on its public page) ----------
create table job_applications.openings (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  title             text not null check (length(trim(title)) between 2 and 80),
  grp               text not null check (grp in ('production', 'lab_quality', 'office_sales', 'delivery_security', 'other')),
  tag               text check (tag is null or length(tag) <= 40),
  description       text not null check (length(trim(description)) between 1 and 1000),
  min_qualification text not null check (length(trim(min_qualification)) between 1 and 500),
  good_to_have      text check (good_to_have is null or length(good_to_have) <= 500),
  status            text not null default 'active' check (status in ('active', 'off')),
  sort_order        int not null default 0,
  created_by        uuid not null,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------- the text at the top of the public page (one row per plant) ----------
create table job_applications.page_settings (
  tenant_id  uuid primary key,
  message    text not null check (length(message) <= 300),
  updated_at timestamptz not null default now()
);

-- ---------- applications (details never change; only the status / first-opened columns move) ----------
create table job_applications.applications (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  ref_no            int not null check (ref_no >= 1),                     -- shown as J-0001
  opening_id        uuid,                                                 -- null = "Any job (just send my resume)"
  opening_title     text check (opening_title is null or length(opening_title) <= 80),  -- the name as it was
  name              text not null check (length(trim(name)) between 2 and 100),
  phone             text not null check (phone ~ '^[6-9][0-9]{9}$'),      -- normalised Indian mobile
  place             text not null check (length(trim(place)) between 2 and 200),
  consent_version   text not null check (length(consent_version) between 1 and 40),
  consent_at        timestamptz not null,
  request_key       text not null check (length(request_key) between 8 and 64),  -- a double tap sends the same key
  status            text not null default 'new' check (status in ('new', 'called', 'shortlisted', 'hired', 'not_suitable')),
  status_changed_at timestamptz not null default now(),
  seen_at           timestamptz,
  seen_by           uuid,
  created_at        timestamptz not null default now(),
  check ((opening_id is null) = (opening_title is null)),
  check ((seen_at is null) = (seen_by is null)),
  unique (tenant_id, ref_no),
  unique (tenant_id, request_key),
  unique (tenant_id, id),
  foreign key (tenant_id, opening_id) references job_applications.openings (tenant_id, id)
);
create index applications_list_idx on job_applications.applications (tenant_id, created_at desc);
create index applications_phone_idx on job_applications.applications (tenant_id, phone, created_at);
create index applications_status_idx on job_applications.applications (tenant_id, status);

-- ---------- history: status changes, notes, first opened (append-only) ----------
create table job_applications.application_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  application_id uuid not null,
  kind           text not null check (kind in ('status', 'note', 'seen')),
  from_status    text check (from_status is null or from_status in ('new', 'called', 'shortlisted', 'hired', 'not_suitable')),
  to_status      text check (to_status is null or to_status in ('new', 'called', 'shortlisted', 'hired', 'not_suitable')),
  text           text check (text is null or length(text) <= 300),
  user_id        uuid not null,
  user_name      text not null,
  at             timestamptz not null default now(),
  check (kind <> 'status' or (from_status is not null and to_status is not null)),
  check (kind <> 'note' or length(trim(coalesce(text, ''))) >= 1),
  unique (tenant_id, id),
  foreign key (tenant_id, application_id) references job_applications.applications (tenant_id, id)
);
create index application_events_idx on job_applications.application_events (application_id, at);

-- ---------- resume pages: one PDF or 1-3 photos (files on disk / S3) ----------
create table job_applications.application_files (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  application_id uuid not null,
  page_no        int not null check (page_no between 1 and 3),
  storage_key    text not null unique,
  content_type   text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 5242880),   -- 5 MB
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  check (content_type <> 'application/pdf' or page_no = 1),
  unique (application_id, page_no),
  foreign key (tenant_id, application_id) references job_applications.applications (tenant_id, id)
);

-- ---------- files of removed applications, waiting to be deleted from storage and the backup ----------
create table job_applications.file_removals (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  storage_key text not null unique,
  queued_at   timestamptz not null default now()
);

-- ---------- support views, audit (setup changes, CSV, removals), outbox ----------
create table job_applications.support_views (
  id               bigint generated always as identity primary key,
  tenant_id        uuid not null,
  super_admin_id   uuid not null,
  super_admin_name text not null,
  path             text not null,
  at               timestamptz not null default now()
);

create table job_applications.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid not null,
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on job_applications.audit_log (tenant_id, at);

create table job_applications.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  input       jsonb not null,
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  given_up_at timestamptz
);
create index notification_outbox_waiting on job_applications.notification_outbox (tenant_id, created_at)
  where sent_at is null and given_up_at is null;

-- ---------- row-level security on every table ----------
do $$
declare t text;
begin
  foreach t in array array['openings', 'page_settings', 'applications', 'application_events', 'application_files',
                           'file_removals', 'support_views', 'audit_log', 'notification_outbox'] loop
    execute format('alter table job_applications.%I enable row level security', t);
    execute format('alter table job_applications.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on job_applications.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- functions (run as the owner login; jobs_app may only call them) ----------
-- The daily job lists plants (ids only), then works inside each plant.
create function job_applications.outbox_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from job_applications.notification_outbox where sent_at is null and given_up_at is null
$$;

-- Plants with files of removed applications still to delete from storage.
create function job_applications.purge_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from job_applications.file_removals
$$;

-- Removes every application sent more than 12 months before p_now (never later than now), with its history and file
-- rows; queues its files for deletion; writes one anonymous audit line per plant. Returns how many were removed.
create function job_applications.purge_applications(p_now timestamptz) returns integer
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_cut timestamptz := least(p_now, now()) - interval '12 months';
  v_count integer;
begin
  insert into job_applications.file_removals (tenant_id, storage_key)
    select f.tenant_id, f.storage_key from job_applications.application_files f
      join job_applications.applications a on a.tenant_id = f.tenant_id and a.id = f.application_id
     where a.created_at < v_cut
  on conflict (storage_key) do nothing;
  delete from job_applications.application_files f using job_applications.applications a
   where a.tenant_id = f.tenant_id and a.id = f.application_id and a.created_at < v_cut;
  delete from job_applications.application_events e using job_applications.applications a
   where a.tenant_id = e.tenant_id and a.id = e.application_id and a.created_at < v_cut;
  with gone as (
    delete from job_applications.applications where created_at < v_cut returning tenant_id
  ), per_plant as (
    select tenant_id, count(*)::int as n from gone group by tenant_id
  ), logged as (
    insert into job_applications.audit_log (tenant_id, actor, action, details)
      select tenant_id, 'system', 'applications.purged', jsonb_build_object('count', n) from per_plant
  )
  select coalesce(sum(n), 0)::int into v_count from per_plant;
  return v_count;
end $$;

-- The owner's "Remove now": one application of the plant set for this transaction, with a reason (3-300 characters).
-- Removes its history and file rows, queues its files; returns its reference number, or null if there is no such
-- application in that plant. The app writes the audit line ("J-0042 removed by <owner>: <reason>") in the same
-- transaction.
create function job_applications.remove_application(p_tenant uuid, p_id uuid, p_reason text) returns integer
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
declare v_ref integer;
begin
  if p_tenant is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'remove_application: not the current plant';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 or length(p_reason) > 300 then
    raise exception 'remove_application: a reason of 3-300 characters is required';
  end if;
  select ref_no into v_ref from job_applications.applications where tenant_id = p_tenant and id = p_id for update;
  if not found then return null; end if;
  insert into job_applications.file_removals (tenant_id, storage_key)
    select tenant_id, storage_key from job_applications.application_files where tenant_id = p_tenant and application_id = p_id
  on conflict (storage_key) do nothing;
  delete from job_applications.application_files where tenant_id = p_tenant and application_id = p_id;
  delete from job_applications.application_events where tenant_id = p_tenant and application_id = p_id;
  delete from job_applications.applications where tenant_id = p_tenant and id = p_id;
  return v_ref;
end $$;

-- After a queued file is deleted from storage and the backup: clears it from the queue (current plant only).
create function job_applications.clear_file_removal(p_tenant uuid, p_key text) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_tenant is distinct from nullif(current_setting('app.tenant_id', true), '')::uuid then
    raise exception 'clear_file_removal: not the current plant';
  end if;
  delete from job_applications.file_removals where tenant_id = p_tenant and storage_key = p_key;
  return found;
end $$;

revoke all on function job_applications.outbox_tenants(), job_applications.purge_tenants(),
  job_applications.purge_applications(timestamptz), job_applications.remove_application(uuid, uuid, text),
  job_applications.clear_file_removal(uuid, text) from public;
grant execute on function job_applications.outbox_tenants(), job_applications.purge_tenants(),
  job_applications.purge_applications(timestamptz), job_applications.remove_application(uuid, uuid, text),
  job_applications.clear_file_removal(uuid, text) to jobs_app;

-- ---------- permissions for jobs_app (never DELETE) ----------
grant select, insert on job_applications.openings, job_applications.page_settings, job_applications.applications,
  job_applications.application_events, job_applications.application_files, job_applications.support_views,
  job_applications.audit_log, job_applications.notification_outbox to jobs_app;
grant select on job_applications.file_removals to jobs_app;      -- filled and cleared only by the functions above
grant update (title, grp, tag, description, min_qualification, good_to_have, status, sort_order, updated_at)
  on job_applications.openings to jobs_app;
grant update (message, updated_at) on job_applications.page_settings to jobs_app;
grant update (status, status_changed_at, seen_at, seen_by) on job_applications.applications to jobs_app;
grant update (attempts, last_error, sent_at, given_up_at) on job_applications.notification_outbox to jobs_app;
