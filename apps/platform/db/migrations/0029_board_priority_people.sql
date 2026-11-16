-- Plant board: priority + cards for specific people (owner, 2026-11-16).
-- Priority: Urgent / Normal / Low, default Normal. The writer picks it when adding the card; afterwards only the owner
-- or a Supervisor changes it (server rule). Existing cards become Normal.
-- For specific people: only the owner or a Supervisor picks the people when adding a card. Such a card is seen only by
-- those people, its writer and the plant's owners (server rule). The people are fixed once the card is saved (no
-- DELETE grant); to change them, remove the card and add a new one. A card with no rows here is for everyone, so
-- every existing card stays visible to the whole plant. Still no notifications.
alter table platform.board_cards
  add column priority text not null default 'normal' check (priority in ('urgent', 'normal', 'low'));
alter table platform.board_cards add constraint board_cards_tenant_id_key unique (tenant_id, id);
grant update (priority) on platform.board_cards to platform_app;

create table platform.board_card_people (
  tenant_id  uuid not null,
  card_id    uuid not null,
  user_id    uuid not null,
  added_by   uuid not null,
  added_at   timestamptz not null default now(),
  primary key (card_id, user_id),
  foreign key (tenant_id, card_id) references platform.board_cards (tenant_id, id),
  foreign key (tenant_id, user_id) references platform.users (tenant_id, id),
  foreign key (tenant_id, added_by) references platform.users (tenant_id, id)
);
create index board_card_people_user on platform.board_card_people (tenant_id, user_id);
alter table platform.board_card_people enable row level security;
alter table platform.board_card_people force row level security;
create policy tenant_isolation on platform.board_card_people
  using (tenant_id = current_setting('app.tenant_id')::uuid)
  with check (tenant_id = current_setting('app.tenant_id')::uuid);
grant select, insert on platform.board_card_people to platform_app;
