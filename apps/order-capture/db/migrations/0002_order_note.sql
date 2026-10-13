-- Order note (owner, 2026-10-13): optional free text typed with a new order ("Deliver after 4 pm", "Gate 2").
-- Fixed once saved, like the customer copy: order_app gets NO update on this column (the grants in 0001 list the
-- updatable columns one by one, so a new column is insert-only). Blank is stored as null.
alter table order_capture.orders
  add column order_note text check (order_note is null or length(trim(order_note)) between 1 and 300);
