-- Batch no. on delivery (owner, 2026-11-20): the batch printed on the bottles (e.g. "PV144") is typed on the Mark
-- delivered panel, which no longer asks for a Zoho invoice no. (bills are made in PlantOps since 6 Nov 2026; old orders
-- keep the Zoho number they have). Optional for now, one per order, saved in capitals: letters, digits, space, comma,
-- "-" and "/" so a mixed load can say "PV144, PV145". A free-text reference, not a link to Lab Records' batches.
-- Two nullable columns; the order's is cleared by "Undo delivered" like the delivery note. Older code ignores them.
alter table order_capture.orders
  add column batch_no text check (batch_no is null or (length(batch_no) between 1 and 40 and batch_no ~ '^[A-Z0-9][A-Z0-9 ,/-]*$')),
  add constraint orders_batch_only_delivered check (status = 'delivered' or batch_no is null);

alter table order_capture.order_events
  add column batch_no text check (batch_no is null or (length(batch_no) between 1 and 40 and batch_no ~ '^[A-Z0-9][A-Z0-9 ,/-]*$')),
  add constraint order_events_batch_only_delivered check (kind = 'delivered' or batch_no is null);

grant update (batch_no) on order_capture.orders to order_app;
