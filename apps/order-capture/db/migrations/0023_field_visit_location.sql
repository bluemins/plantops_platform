-- Field day log, Phase 1 (docs/FIELD_DAY_PHASE_PLAN.md; owner approved 2026-11-14): a shop location saved from a field
-- staff's visit in Attendance carries that visit's id, so "Try again" can never save the same visit twice. One column,
-- two checks and one unique index on customer_locations; no new table, no grant change (order_app: SELECT + INSERT).
alter table order_capture.customer_locations add column visit_id uuid;

alter table order_capture.customer_locations
  -- a field visit always names its visit; nothing else does (a clear has no source)
  add constraint customer_locations_visit_check check (kind = 'clear' or (source = 'field_visit') = (visit_id is not null)),
  -- a field visit always comes from the phone's GPS, so it has an accuracy (the ±150 m cap is the column's own check)
  add constraint customer_locations_field_accuracy check (source is distinct from 'field_visit' or accuracy_m is not null);

create unique index customer_locations_one_per_visit on order_capture.customer_locations (tenant_id, visit_id) where visit_id is not null;
