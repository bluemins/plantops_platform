-- Customer support contact on Business details (owner, 2026-10-21; docs/WHATSAPP_CONTRACT.md 3.2 `support`): the
-- number customers are told to call and the hours, as the owner types them (days included). Both optional. The
-- WhatsApp bot shows them when a customer asks for a person (through Order Capture from Step 2). The existing
-- table-level grants already cover the new columns.
alter table platform.tenant_profiles
  add column support_phone text check (support_phone ~ '^\+?[0-9][0-9 -]{6,18}$'),
  add column support_hours text check (char_length(support_hours) between 1 and 60);
