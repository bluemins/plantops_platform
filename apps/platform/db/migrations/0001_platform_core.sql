-- Phase 1: platform core tables, row-level security and permissions.
-- Runs as plantops_owner. Logins platform_app / platform_super are created by scripts/setup-local-db.sql.
--
-- Isolation model (see CLAUDE.md "Row-level security rules"):
--   * Every table that holds plant data has ENABLE + FORCE ROW LEVEL SECURITY and one policy:
--     rows are visible/writable only when they belong to current_setting('app.tenant_id').
--   * platform_app (all plant-user requests) is always subject to those policies. If app.tenant_id is not
--     set, the policy errors -> nothing leaks (fails closed).
--   * platform_super (super_admin routes only) has BYPASSRLS.
--   * Codes, usernames and emails are stored normalised (upper/lower case) so no extensions are needed.

-- ---------- reference data (shared by all tenants, read-only for the app) ----------
create table platform.modules (
  id                 text primary key,
  name               text not null,
  base_url           text,
  client_secret_hash text,
  status             text not null default 'active' check (status in ('active', 'disabled'))
);

create table platform.roles (
  id        text primary key,
  module_id text references platform.modules (id),
  label     text not null
);

insert into platform.modules (id, name) values
  ('lab_records', 'Lab Records'),
  ('floor_stock', 'Floor Stock'),
  ('preventive_mgmt', 'Preventive Mgmt'),
  ('amc', 'AMC'),
  ('attendance_salary', 'Attendance & Salary'),
  ('marketing_contacts', 'Marketing Contacts');

insert into platform.roles (id, module_id, label) values
  ('tenant_admin', null, 'Plant owner'),
  ('lab_technician', 'lab_records', 'Lab technician'),
  ('store_keeper', 'floor_stock', 'Store keeper'),
  ('maintenance_technician', 'preventive_mgmt', 'Maintenance technician');

-- ---------- super admins (PlantOps operator; not tenant data) ----------
create table platform.super_admins (
  id              uuid primary key default gen_random_uuid(),
  email           text not null unique check (email = lower(email)),
  name            text not null,
  password_hash   text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  disabled_at     timestamptz,
  created_at      timestamptz not null default now()
);

create table platform.super_admin_sessions (
  id_hash        text primary key,
  super_admin_id uuid not null references platform.super_admins (id),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now()
);

-- ---------- tenants (plants) ----------
create table platform.tenants (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  name       text not null,
  status     text not null default 'active' check (status in ('active', 'suspended')),
  hosting    text not null default 'shared' check (hosting in ('shared', 'dedicated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table platform.tenant_plans (
  tenant_id       uuid primary key references platform.tenants (id),
  plan_name       text not null,
  enabled_modules text[] not null default '{}',
  limits          jsonb not null default '{}',
  renews_on       date,
  updated_at      timestamptz not null default now(),
  updated_by      text not null
);

-- ---------- users and roles ----------
create table platform.users (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references platform.tenants (id),
  username           text not null check (username ~ '^[a-z0-9._-]{2,40}$'),
  display_name       text not null,
  phone              text,
  email              text check (email = lower(email)),
  secret_hash        text not null,
  secret_kind        text not null check (secret_kind in ('pin', 'password')),
  failed_attempts    int not null default 0,
  locked_until       timestamptz,
  must_change_secret boolean not null default true,
  status             text not null default 'active' check (status in ('active', 'disabled')),
  created_at         timestamptz not null default now(),
  created_by         text not null,
  unique (tenant_id, username),
  unique (tenant_id, id)
);

create table platform.user_roles (
  tenant_id  uuid not null,
  user_id    uuid not null,
  role_id    text not null references platform.roles (id),
  granted_at timestamptz not null default now(),
  granted_by text not null,
  primary key (user_id, role_id),
  -- composite key: a role row can never point at a user of a different tenant
  foreign key (tenant_id, user_id) references platform.users (tenant_id, id)
);

-- ---------- sessions, SSO handoff codes, audit ----------
create table platform.sessions (
  id_hash    text primary key,
  tenant_id  uuid not null,
  user_id    uuid not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references platform.users (tenant_id, id)
);
create index sessions_user_idx on platform.sessions (user_id);

create table platform.sso_handoff_codes (
  code_hash  text primary key,
  tenant_id  uuid not null,
  user_id    uuid not null,
  module_id  text not null references platform.modules (id),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references platform.users (tenant_id, id)
);

-- Append-only: no role is granted UPDATE or DELETE on this table.
create table platform.audit_log (
  id        bigint generated always as identity primary key,
  tenant_id uuid references platform.tenants (id),
  actor     text not null,
  action    text not null,
  target    text,
  details   jsonb not null default '{}',
  at        timestamptz not null default now()
);
create index audit_log_tenant_idx on platform.audit_log (tenant_id, at);

-- ---------- row-level security ----------
alter table platform.tenants enable row level security;
alter table platform.tenants force row level security;
create policy tenant_isolation on platform.tenants
  using (id = current_setting('app.tenant_id')::uuid)
  with check (id = current_setting('app.tenant_id')::uuid);

do $$
declare t text;
begin
  foreach t in array array['tenant_plans', 'users', 'user_roles', 'sessions', 'sso_handoff_codes', 'audit_log'] loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);
    execute format(
      'create policy tenant_isolation on platform.%I
         using (tenant_id = current_setting(''app.tenant_id'')::uuid)
         with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- ---------- functions used before a tenant is known (run as owner, return the minimum) ----------
-- Login: plant code -> tenant id, only for active tenants.
create function platform.resolve_tenant(p_code text) returns uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select t.id from platform.tenants t where t.code = upper(p_code) and t.status = 'active'
$$;

-- SSO exchange: atomically burns a one-time code meant for this module. Returns no row if the code is
-- unknown, already used, expired or meant for another module.
create function platform.consume_handoff_code(p_code_hash text, p_module_id text)
returns table (tenant_id uuid, user_id uuid)
language sql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
  update platform.sso_handoff_codes c
     set used_at = now()
   where c.code_hash = p_code_hash
     and c.module_id = p_module_id
     and c.used_at is null
     and c.expires_at > now()
  returning c.tenant_id, c.user_id
$$;

revoke all on function platform.resolve_tenant(text) from public;
revoke all on function platform.consume_handoff_code(text, text) from public;

-- ---------- permissions ----------
grant usage on schema platform to platform_app, platform_super;

-- platform_app: plant users. Users are disabled, never deleted (keeps the audit trail intact).
grant select on platform.modules, platform.roles to platform_app;
grant select on platform.tenants, platform.tenant_plans to platform_app;
grant select, insert, update on platform.users to platform_app;
grant select, insert, delete on platform.user_roles to platform_app;
grant select, insert, update on platform.sessions to platform_app;
grant insert on platform.sso_handoff_codes to platform_app;
grant select, insert on platform.audit_log to platform_app;
grant execute on function platform.resolve_tenant(text), platform.consume_handoff_code(text, text) to platform_app;

-- platform_super: super_admin routes only (BYPASSRLS).
grant select on platform.modules, platform.roles to platform_super;
grant select, insert, update on platform.super_admins, platform.super_admin_sessions to platform_super;
grant select, insert, update on platform.tenants, platform.tenant_plans, platform.users to platform_super;
grant select, insert, delete on platform.user_roles to platform_super;
grant select, update on platform.sessions to platform_super;
grant select, insert on platform.audit_log to platform_super;
