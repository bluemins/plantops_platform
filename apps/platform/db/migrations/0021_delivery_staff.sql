-- Delivery staff (owner, 2026-11-04; docs/CALLS_PHASE_PLAN.md): Order Capture's Calls tab only. Calls customers back,
-- marks calls attended and saves new callers to the customer list; no orders, no amounts. Never ticked for alerts.
insert into platform.roles (id, module_id, label) values ('delivery_staff', 'order_capture', 'Delivery staff');
