-- Plant answers Phase 5 (owner, 2026-11-28; docs/MORNING_REPORT_PHASE_PLAN.md): the 8:30 am morning report.
-- One saved report per plant per day, so it doesn't change during the day and the owner's Useful / Not useful taps
-- point at what was actually sent. It records how it was made (prepared_by: the rules and wording versions), so a later
-- optional AI version could sit beside it without changing old reports. Read-only facts: it never changes a bill, an
-- order, a payment or a count.
-- Two new tables; order_app gets SELECT + INSERT only (never changed, never deleted). Older code ignores them.

create table order_capture.morning_reports (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  report_date  date not null,
  -- the chosen actions in order: [{ card, level, text, share_text, href }], at most 7 (D11)
  actions      jsonb not null check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) <= 7),
  -- the card facts the actions were picked from, as they were at 8:30
  facts        jsonb not null check (jsonb_typeof(facts) = 'object'),
  -- what could not be checked ("Floor Stock did not answer"), shown on the page; never treated as zero
  missing      jsonb not null default '[]' check (jsonb_typeof(missing) = 'array'),
  -- the notification's line, also the page heading
  summary      text not null check (length(trim(summary)) between 1 and 300),
  -- { by: "rules", rules: <RULES_VERSION>, wording: <WORDING_VERSION> }
  prepared_by  jsonb not null check (prepared_by ? 'by'),
  created_at   timestamptz not null default now(),
  unique (tenant_id, id),
  -- one per plant per day: the 8:30 job can run twice safely (insert ... on conflict do nothing)
  unique (tenant_id, report_date)
);

alter table order_capture.morning_reports enable row level security;
alter table order_capture.morning_reports force row level security;
create policy tenant_isolation on order_capture.morning_reports
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.morning_reports to order_app;

-- The owner's Useful / Not useful tap per action (owner only, decided 2026-11-28 P5-d). Append-only: changing your mind
-- is a new row and the latest one per person and action counts. Phase 7 tunes the rules from these.
create table order_capture.morning_report_marks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  report_id    uuid not null,
  action_no    smallint not null check (action_no between 1 and 7),
  mark         text not null check (mark in ('useful', 'not_useful')),
  user_id      uuid not null,
  user_name    text not null check (length(trim(user_name)) between 1 and 100),
  created_at   timestamptz not null default now(),
  foreign key (tenant_id, report_id) references order_capture.morning_reports (tenant_id, id)
);
create index morning_report_marks_report on order_capture.morning_report_marks (tenant_id, report_id, created_at);

alter table order_capture.morning_report_marks enable row level security;
alter table order_capture.morning_report_marks force row level security;
create policy tenant_isolation on order_capture.morning_report_marks
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);

grant select, insert on order_capture.morning_report_marks to order_app;
