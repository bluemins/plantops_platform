-- Plant board (owner, 2026-11-14): a whiteboard every person of the plant sees and writes on, whatever their role,
-- used by staff to plan the next day. One row per card, for one India date. Approved by the owner 2026-11-14:
-- the writer edits / removes their own card, the owner removes any; anyone ticks a card done; no notifications.
-- Nothing is deleted: a removed card keeps its row (removed_by / removed_at) and edits and removals are audited.
create table platform.board_cards (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  for_date    date not null,
  body        text not null check (char_length(btrim(body)) between 1 and 300),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  done_by     uuid,
  done_at     timestamptz,
  removed_by  uuid,
  removed_at  timestamptz,
  check ((done_by is null) = (done_at is null)),
  check ((removed_by is null) = (removed_at is null)),
  foreign key (tenant_id, created_by) references platform.users (tenant_id, id),
  foreign key (tenant_id, done_by) references platform.users (tenant_id, id),
  foreign key (tenant_id, removed_by) references platform.users (tenant_id, id)
);
create index board_cards_day on platform.board_cards (tenant_id, for_date);
alter table platform.board_cards enable row level security;
alter table platform.board_cards force row level security;
create policy tenant_isolation on platform.board_cards
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
grant select, insert on platform.board_cards to platform_app;
grant update (body, edited_at, done_by, done_at, removed_by, removed_at) on platform.board_cards to platform_app;
