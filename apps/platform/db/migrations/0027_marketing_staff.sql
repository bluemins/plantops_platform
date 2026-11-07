-- Marketing staff (owner, 2026-11-07): Sales customers. The customer list and pages, adds customers, edits their
-- details incl. the mobile (GST details and payment terms stay owner-only), comments, contact persons, shop location;
-- sees a customer's bills, payments and statement read-only. No orders, no Bills section, never ticked for alerts.
insert into platform.roles (id, module_id, label) values ('marketing_staff', 'order_capture', 'Marketing staff');
