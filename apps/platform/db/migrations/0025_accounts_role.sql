-- Accounts (owner, 2026-11-06): Order Capture's money after delivery. Bills, Make bill, Receive payment, a customer's
-- account and statement; sees orders and their amounts read-only. Order desk no longer sees bills: the owner gives
-- Accounts only to the people who handle money. Plant totals, cancelling a bill / payment and CSV stay owner-only.
insert into platform.roles (id, module_id, label) values ('accounts', 'order_capture', 'Accounts');
