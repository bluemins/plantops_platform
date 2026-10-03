-- Phase 3: super_admin "support view" (CLAUDE.md "Support token"). super_admin opens ONE plant's module data
-- read-only: a one-time code (60 s, single use, bound to one module and one plant), swapped by the module
-- server-to-server for a token with purpose "support". Modules accept it only through verifySupportToken.
create table platform.support_handoff_codes (
  code_hash      text primary key,
  super_admin_id uuid not null references platform.super_admins (id),
  tenant_id      uuid not null references platform.tenants (id),
  module_id      text not null references platform.modules (id),
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- Holds tenant_id, so it follows the same rule as every plant table (super_admin's login bypasses RLS).
alter table platform.support_handoff_codes enable row level security;
alter table platform.support_handoff_codes force row level security;
create policy tenant_isolation on platform.support_handoff_codes
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- Exchange: atomically burns a code meant for this module. No row if unknown, used, expired or another module's.
create function platform.consume_support_code(p_code_hash text, p_module_id text)
returns table (tenant_id uuid, super_admin_id uuid)
language sql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
  update platform.support_handoff_codes c
     set used_at = now()
   where c.code_hash = p_code_hash
     and c.module_id = p_module_id
     and c.used_at is null
     and c.expires_at > now()
  returning c.tenant_id, c.super_admin_id
$$;

revoke all on function platform.consume_support_code(text, text) from public;
grant execute on function platform.consume_support_code(text, text) to platform_app;
grant select, insert on platform.support_handoff_codes to platform_super;
