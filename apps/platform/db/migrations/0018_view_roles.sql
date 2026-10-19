-- View-only roles (owner, 2026-10-19; docs/VIEW_ROLES_PHASE_PLAN.md). Each opens one module read-only and never works
-- in it: Stock viewer (Floor Stock, only the sections the owner picks for them), Document viewer (Document Store),
-- Order viewer (Order Capture, orders without amounts). Stock and Document viewers can be ticked for alerts.
insert into platform.roles (id, module_id, label) values
  ('stock_viewer',    'floor_stock',    'Stock viewer'),
  ('document_viewer', 'document_store', 'Document viewer'),
  ('order_viewer',    'order_capture',  'Order viewer');
