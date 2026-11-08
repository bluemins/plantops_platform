-- Free boxes on the order (scheme, e.g. "12 + 1 free") (owner, 2026-11-08, approved; docs/FREE_BOXES_PHASE_PLAN.md).
-- A free line is its own order line: the product, the free count and the rate the customer would have paid (only to
-- show what the free boxes are worth); its amount is always 0. An order may hold each product once paid and once free.
-- Existing rows read as not free, so nothing saved changes. No grant change: both tables stay SELECT + INSERT.

-- 1. Order lines
alter table order_capture.order_lines
  add column free boolean not null default false;

alter table order_capture.order_lines drop constraint order_lines_check;
alter table order_capture.order_lines
  add constraint order_lines_total_check
    check ((free and line_total = 0) or (not free and line_total = quantity * rate));

alter table order_capture.order_lines drop constraint order_lines_tenant_id_order_id_version_sku_id_key;
alter table order_capture.order_lines
  add constraint order_lines_product_once unique (tenant_id, order_id, version, sku_id, free);

-- 2. Bill lines: a free line is copied from the order with the worth rate and a discount of the whole line (= 0).
alter table order_capture.bill_lines
  add column free boolean not null default false;
alter table order_capture.bill_lines
  add constraint bill_lines_free_is_zero check (not free or line_total = 0);
