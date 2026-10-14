-- Notes added after an order is saved (owner, 2026-10-14): "customer paid cash", "call before 4 pm". The note typed
-- with the order (0002) stays fixed; each later note is one more history event, kind 'note', with its text, who and
-- when. Any status (pending, delivered, cancelled); owner and Order desk only (checked on the server). Append-only like
-- every event: order_app still has no UPDATE / DELETE on order_events.
alter table order_capture.order_events drop constraint order_events_kind_check;
alter table order_capture.order_events
  add constraint order_events_kind_check check (kind in ('created', 'changed', 'delivered', 'undelivered', 'cancelled', 'note'));
-- a note always has text
alter table order_capture.order_events
  add constraint order_events_note_text check (kind <> 'note' or length(trim(coalesce(text, ''))) >= 1);
