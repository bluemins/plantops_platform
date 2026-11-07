-- Customer page Part 2 + GST details (owner, 2026-11-07, approved; docs/CUSTOMER_PAGE_PHASE_PLAN.md). Rule: the
-- customer's NAME is the calling name everywhere in Sales (order form, lists, ordinary bills); the GST details (legal name, GSTIN, billing address, GST state) are a separate block on the
-- same customer, used only by GST bills and the Zoho file. Existing rows are untouched (every new column is empty).
-- No DELETE anywhere; comments and locations are append-only.

-- 1. Customers: GST details, contact, delivery, terms. gstin and state_code already exist (0009) and are the GST
--    block's GSTIN and GST state (= place of supply).
alter table order_capture.customers
  -- GST details (only for GST bills / Zoho)
  add column legal_name       text check (legal_name is null or length(trim(legal_name)) between 2 and 200),
  add column gst_treatment    text check (gst_treatment in ('registered', 'unregistered', 'consumer')),
  add column billing_address  text check (billing_address is null or length(trim(billing_address)) between 2 and 300),
  add column billing_city     text check (billing_city is null or length(trim(billing_city)) between 2 and 80),
  add column billing_pin      text check (billing_pin is null or billing_pin ~ '^[1-9][0-9]{5}$'),
  -- contact
  add column email            text check (email is null or (length(email) <= 120 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column other_phone      text check (other_phone is null or other_phone ~ '^[0-9]{6,15}$'),
  add column customer_type    text check (customer_type in ('shop', 'household', 'office', 'institution', 'individual')),
  -- delivery (empty = same as billing / the place)
  add column delivery_address text check (delivery_address is null or length(trim(delivery_address)) between 2 and 300),
  add column delivery_landmark text check (delivery_landmark is null or length(trim(delivery_landmark)) between 2 and 150),
  -- this customer's payment terms (empty = the plant's default from Bill settings)
  add column payment_terms    text check (payment_terms in ('receipt', 'net7', 'net15', 'net30', 'eom'));

-- The owner may change these (Edit), plus the mobile (with a reason, audited; the unique (tenant_id, phone) index
-- already refuses a number another customer has). Old orders and bills keep their own copies.
grant update (legal_name, gst_treatment, billing_address, billing_city, billing_pin, email, other_phone, customer_type,
              delivery_address, delivery_landmark, payment_terms, phone, phone_typed)
  on order_capture.customers to order_app;

-- 2. Bills: a GST bill keeps a copy of who it was billed to (legal name + address as on that day), so a later edit of
--    the customer never changes a past bill. customer_name stays the calling name (lists, statements).
alter table order_capture.bills
  add column bill_to_name    text check (bill_to_name is null or length(trim(bill_to_name)) between 2 and 200),
  add column bill_to_address text check (bill_to_address is null or length(trim(bill_to_address)) between 2 and 500),
  add column gst_treatment   text check (gst_treatment in ('registered', 'unregistered', 'consumer')),
  -- only GST bills carry these
  add constraint bills_bill_to_only_gst check (needs_gst or (bill_to_name is null and bill_to_address is null and gst_treatment is null));
-- (no UPDATE grant: set once when the bill is made)

-- 3. Comments on a customer (owner writes; never changed).
create table order_capture.customer_comments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid not null,
  body        text not null check (length(trim(body)) between 1 and 500),
  by_user     uuid not null,
  by_name     text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index customer_comments_by_customer on order_capture.customer_comments (tenant_id, customer_id, created_at);

-- 4. Contact persons (several per customer); switched off, never deleted.
create table order_capture.customer_persons (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid not null,
  name        text not null check (length(trim(name)) between 2 and 100),
  phone       text check (phone is null or phone ~ '^[0-9]{6,15}$'),
  role        text check (role is null or length(trim(role)) between 2 and 60),
  active      boolean not null default true,
  by_user     uuid not null,
  by_name     text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index customer_persons_by_customer on order_capture.customer_persons (tenant_id, customer_id);

-- 5. Shop location: every save or clear is a new row; the newest row is the customer's location.
--    source: 'phone' (Save my location here), 'map_link' (owner pasted a Google Maps link), 'field_visit' (later, from
--    Attendance's field day log).
create table order_capture.customer_locations (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  customer_id uuid not null,
  kind        text not null check (kind in ('set', 'clear')),
  lat         numeric(9, 6) check (lat between -90 and 90),
  lng         numeric(9, 6) check (lng between -180 and 180),
  accuracy_m  int check (accuracy_m between 0 and 150),
  source      text check (source in ('phone', 'map_link', 'field_visit')),
  reason      text check (reason is null or length(trim(reason)) between 3 and 200),
  by_user     uuid not null,
  by_name     text not null,
  created_at  timestamptz not null default now(),
  -- a 'set' has a position and a source; a 'clear' has a reason and no position
  check ((kind = 'set') = (lat is not null and lng is not null and source is not null)),
  check ((kind = 'clear') = (reason is not null and lat is null and lng is null)),
  check (source <> 'phone' or accuracy_m is not null),
  unique (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index customer_locations_by_customer on order_capture.customer_locations (tenant_id, customer_id, created_at);

-- 6. Plant isolation (FORCE RLS) and the app login's rights: read + add only, except a contact person's on / off.
alter table order_capture.customer_comments enable row level security;
alter table order_capture.customer_comments force row level security;
create policy tenant_isolation on order_capture.customer_comments
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.customer_persons enable row level security;
alter table order_capture.customer_persons force row level security;
create policy tenant_isolation on order_capture.customer_persons
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.customer_locations enable row level security;
alter table order_capture.customer_locations force row level security;
create policy tenant_isolation on order_capture.customer_locations
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.customer_comments, order_capture.customer_persons, order_capture.customer_locations to order_app;
grant update (active) on order_capture.customer_persons to order_app;
