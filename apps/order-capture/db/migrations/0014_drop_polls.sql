-- Drop (customer app) Phase 4: polls (owner, 2026-11-09; docs/CUSTOMER_APP_PHASE_PLAN.md "Polls tab"). Two new tables
-- with FORCE RLS: the owner's polls and the shops' answers. A published poll is never edited (a new poll corrects it);
-- the owner may only close it early, once. An answer is never changed; the poll points it earned are decided when it is
-- saved and kept on the row. No existing table, column or grant changes. Backward-compatible: v0.51.x ignores both.

-- 1. Polls: a question with 2–6 choices (and an optional "Other" box), open between two times, for some brands.
create table order_capture.polls (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  question              text not null check (length(trim(question)) between 3 and 150),
  choices               text[] not null check (cardinality(choices) between 2 and 6),
  other_allowed         boolean not null default false,
  brands                text[] not null check (cardinality(brands) between 1 and 10),
  opens_at              timestamptz not null,
  closes_at             timestamptz not null,
  closed_early_at       timestamptz,
  closed_early_by       uuid,
  closed_early_by_name  text,
  created_by            uuid not null,
  created_by_name       text not null,
  created_at            timestamptz not null default now(),
  unique (tenant_id, id),
  check (closes_at > opens_at),
  check ((closed_early_at is null) = (closed_early_by is null) and (closed_early_by is null) = (closed_early_by_name is null))
);
create index polls_by_time on order_capture.polls (tenant_id, opens_at);

create function order_capture.polls_close_once() returns trigger
language plpgsql as $$
begin
  if OLD.closed_early_at is not null and (NEW.closed_early_at, NEW.closed_early_by, NEW.closed_early_by_name)
       is distinct from (OLD.closed_early_at, OLD.closed_early_by, OLD.closed_early_by_name) then
    raise exception 'a poll is closed early only once' using errcode = 'check_violation';
  end if;
  return NEW;
end
$$;
create trigger polls_closed_once before update on order_capture.polls
  for each row execute function order_capture.polls_close_once();

-- 2. Answers: one per shop per poll, never changed. choice = the choice's place in the list (0 = first); -1 = "Other"
--    with its text. points / points_reason are decided when the answer is saved (10 for the week's first answer of a
--    shop with an order delivered in the last 30 days; else 0 and why).
create table order_capture.poll_answers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  poll_id        uuid not null,
  customer_id    uuid not null,
  phone          text not null check (phone ~ '^[6-9][0-9]{9}$'),
  choice         int not null check (choice between -1 and 5),
  other_text     text check (other_text is null or length(trim(other_text)) between 1 and 100),
  points         int not null default 0 check (points between 0 and 1000),
  points_reason  text not null check (points_reason in ('counted', 'week_used', 'no_recent_order', 'points_off')),
  created_at     timestamptz not null default now(),
  unique (tenant_id, poll_id, customer_id),
  check ((choice = -1) = (other_text is not null)),
  check ((points_reason = 'counted') = (points > 0)),
  foreign key (tenant_id, poll_id) references order_capture.polls (tenant_id, id),
  foreign key (tenant_id, customer_id) references order_capture.customers (tenant_id, id)
);
create index poll_answers_by_customer on order_capture.poll_answers (tenant_id, customer_id, created_at);

-- 3. Row-level security like every other table; order_app reads and adds rows, and may only close a poll early.
alter table order_capture.polls enable row level security;
alter table order_capture.polls force row level security;
create policy tenant_isolation on order_capture.polls
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);
alter table order_capture.poll_answers enable row level security;
alter table order_capture.poll_answers force row level security;
create policy tenant_isolation on order_capture.poll_answers
  using (tenant_id = current_setting('app.tenant_id')::uuid) with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.polls, order_capture.poll_answers to order_app;
grant update (closed_early_at, closed_early_by, closed_early_by_name) on order_capture.polls to order_app;
