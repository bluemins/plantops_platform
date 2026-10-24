-- WhatsApp Step 4 (docs/WHATSAPP_BUILD_PLAN.md section 9, owner 2026-10-24): consent to reorder reminders, the
-- pilot's random groups, and the reminder as a second kind of customer message. Nothing is changed or deleted:
-- consent and groups are append-only (a customer's consent = their newest row); a reminder moves only its sending
-- columns, like the thank-you. Backward-compatible: v0.30.0 code keeps working on it.

-- 1. Consent (kept forever). One row per change: asked after an order, ticked by staff, STOP / START, the button.
create table order_capture.customer_consents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,
  customer_id   uuid not null,
  scope         text not null check (scope in ('reorder_reminder')),
  status        text not null check (status in ('granted', 'declined', 'withdrawn')),
  wording       text not null check (wording in ('optin-v1')),
  source        text not null check (source in ('bot_after_order', 'staff_phone', 'whatsapp_stop', 'whatsapp_start', 'reminder_button')),
  message_sid   text check (message_sid is null or message_sid ~ '^[A-Za-z0-9]{1,64}$'),
  created_by    uuid not null,          -- the bot key id, or the staff member
  created_by_name text not null,        -- "WhatsApp", or the staff member's name
  created_at    timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index customer_consents_latest on order_capture.customer_consents (tenant_id, customer_id, scope, created_at desc);

-- 2. The pilot's groups: drawn once per customer at random (70 % remind / 30 % holdout), never changed.
create table order_capture.reminder_groups (
  tenant_id     uuid not null,
  customer_id   uuid not null,
  grp           text not null check (grp in ('remind', 'holdout')),
  created_at    timestamptz not null default now(),
  primary key (tenant_id, customer_id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);

-- 3. The reminder is a customer message like the thank-you: one per delivered order (existing unique key), plus
--    'skipped' with a reason (holdout, no consent, newer order, caps …) so the pilot report counts every due one.
alter table order_capture.customer_messages drop constraint customer_messages_kind_check;
alter table order_capture.customer_messages add constraint customer_messages_kind_check check (kind in ('delivery_thanks', 'reorder_reminder'));
alter table order_capture.customer_messages drop constraint customer_messages_status_check;
alter table order_capture.customer_messages add constraint customer_messages_status_check check (status in ('pending', 'sent', 'failed', 'skipped'));
alter table order_capture.customer_messages add column skip_reason text
  check (skip_reason is null or skip_reason in ('holdout', 'no_consent', 'newer_order', 'recent_reminder', 'customer_off', 'pilot_full', 'budget', 'pilot_ended'));
alter table order_capture.customer_messages add check ((status = 'skipped') = (skip_reason is not null));

-- 4. Row-level security on the new tables, like every other.
alter table order_capture.customer_consents enable row level security;
alter table order_capture.customer_consents force row level security;
create policy tenant_isolation on order_capture.customer_consents
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.reminder_groups enable row level security;
alter table order_capture.reminder_groups force row level security;
create policy tenant_isolation on order_capture.reminder_groups
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

-- 5. The reminder job lists plants with at least one consent (ids only), then works inside each plant.
create function order_capture.reminder_tenants() returns setof uuid
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select distinct tenant_id from order_capture.customer_consents
$$;
revoke all on function order_capture.reminder_tenants() from public;
grant execute on function order_capture.reminder_tenants() to order_app;

-- 6. Grants: read + add only (no UPDATE, no DELETE) on the new tables. customer_messages keeps its grants (a skipped
--    reminder is written as 'skipped' at once, never changed).
grant select, insert on order_capture.customer_consents, order_capture.reminder_groups to order_app;
