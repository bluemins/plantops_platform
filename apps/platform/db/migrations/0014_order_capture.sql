-- Order Capture module (orders taken by staff on their phones instead of a WhatsApp message) and its staff role.
-- Plan: docs/ORDER_CAPTURE_PHASE_PLAN.md. Plant staff do NOT work in it: it is in PLANT_STAFF_EXCLUDED
-- (packages/types), so a plant staff member who takes orders is also given "Order desk".
insert into platform.modules (id, name) values ('order_capture', 'Order Capture');
insert into platform.roles (id, module_id, label) values ('order_desk', 'order_capture', 'Order desk');
