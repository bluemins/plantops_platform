-- Cash book step C4 (owner, 2026-11-12; docs/CASHBOOK_PHASE_PLAN.md section 9, approved "Yes, as described"): staff cash
-- linked to Attendance.
-- - "Advance against salary" given from the cash box is sent to Attendance as an advance; cash a person brings back for
--   an advance ("Took back") is sent as a correction of that advance; cancelling a cash-book advance sends a correction
--   for what is left. Each send is a row in attendance_sends (waiting -> sent / refused), retried by the daily job.
-- - "Spent from cash given": what a person paid out of cash given to them "for plant spending". It never moves money in
--   the box (the cash left the box when it was given); "Open with staff" = given − returned − spent.
-- Two new tables, one new column and one widened check on cash_entries. Nothing is deleted; existing rows stay valid
-- (old "Took back" rows have no purpose). Backward-compatible: v0.66.x code never writes the new values.

-- 1. "Took back" may say what it is for (advance / plant spending); an advance returned names the advance it was for.
alter table order_capture.cash_entries add column returns_entry_id uuid;
alter table order_capture.cash_entries drop constraint cash_entries_check4; -- was: (kind = 'staff_out') = (staff_purpose is not null)
alter table order_capture.cash_entries add constraint cash_entries_purpose check (
  case kind
    when 'staff_out' then staff_purpose is not null
    when 'staff_in' then staff_purpose is null or staff_purpose in ('advance', 'plant')
    else staff_purpose is null
  end);
alter table order_capture.cash_entries add constraint cash_entries_returns check (
  (returns_entry_id is not null) = (kind = 'staff_in' and staff_purpose is not distinct from 'advance'));
alter table order_capture.cash_entries add constraint cash_entries_returns_fk
  foreign key (tenant_id, returns_entry_id) references order_capture.cash_entries (tenant_id, id);

-- 2. What was sent to Attendance. One row per advance / return / cancel; source_ref is what Attendance stores to keep
--    a second send of the same thing from being saved twice ("C-0123", "C-0123/cancel").
create table order_capture.attendance_sends (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  cash_entry_id   uuid not null,
  action          text not null check (action in ('advance', 'return', 'cancel')),
  source_ref      text not null check (length(source_ref) between 1 and 40),
  payload         jsonb not null,
  status          text not null default 'waiting' check (status in ('waiting', 'sent', 'refused')),
  attempts        int not null default 0 check (attempts >= 0),
  last_error      text check (last_error is null or length(last_error) <= 300),
  attendance_id   uuid,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'sent') = (sent_at is not null)),
  unique (tenant_id, source_ref),
  unique (tenant_id, id),
  foreign key (tenant_id, cash_entry_id) references order_capture.cash_entries (tenant_id, id)
);
create index attendance_sends_entry on order_capture.attendance_sends (tenant_id, cash_entry_id);

-- 3. Spent from cash given (a person's plant-spending cash). Cancelled by the owner with a reason, never deleted.
create table order_capture.staff_cash_spends (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  person_user_id    uuid,
  person_name       text not null check (length(trim(person_name)) between 1 and 100),
  spent_on          date not null,
  category_id       uuid not null,
  amount            numeric(14, 2) not null check (amount > 0 and amount <= 10000000),
  paid_to           text check (paid_to is null or length(paid_to) <= 100),
  note              text check (note is null or length(note) <= 300),
  created_by        uuid not null,
  created_by_name   text not null,
  created_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid,
  cancelled_by_name text,
  cancel_reason     text check (cancel_reason is null or length(trim(cancel_reason)) between 3 and 300),
  check ((cancelled_at is null) = (cancelled_by is null) and (cancelled_by is null) = (cancelled_by_name is null)
         and (cancelled_by_name is null) = (cancel_reason is null)),
  unique (tenant_id, id),
  foreign key (tenant_id, category_id) references order_capture.expense_categories (tenant_id, id)
);
create index staff_cash_spends_person on order_capture.staff_cash_spends (tenant_id, person_user_id);

-- 4. Row-level security, like every other table.
do $$
declare t text;
begin
  foreach t in array array['attendance_sends', 'staff_cash_spends'] loop
    execute format('alter table order_capture.%I enable row level security', t);
    execute format('alter table order_capture.%I force row level security', t);
    execute format('create policy tenant_isolation on order_capture.%I using (tenant_id = current_setting(''app.tenant_id'')::uuid) with check (tenant_id = current_setting(''app.tenant_id'')::uuid)', t);
  end loop;
end $$;

-- 5. The daily job lists plants with sends still waiting (ids only), then works inside each plant.
create function order_capture.attendance_send_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from order_capture.attendance_sends where status = 'waiting'
$$;
revoke all on function order_capture.attendance_send_tenants() from public;
grant execute on function order_capture.attendance_send_tenants() to order_app;

-- 6. Grants: read + add; a send's status / tries change, a spend's cancel columns change; no DELETE anywhere.
grant select, insert on order_capture.attendance_sends, order_capture.staff_cash_spends to order_app;
grant update (status, attempts, last_error, attendance_id, sent_at, updated_at) on order_capture.attendance_sends to order_app;
grant update (cancelled_at, cancelled_by, cancelled_by_name, cancel_reason) on order_capture.staff_cash_spends to order_app;
