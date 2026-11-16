-- "GST bill" tick on purchase bills (owner, 2026-11-16): the owner or Accounts marks which purchase bills go into the tax
-- records, so the Purchase bills list shows a GST tag. A label only: no amount, payment or GST line changes with it, and
-- the GST amounts on a bill don't decide it (the owner: "do not go with" GST > 0). Every bill already here starts
-- unticked (owner); a new bill starts ticked when the vendor has a GSTIN (in the form, changeable before saving). The
-- tick can be changed afterwards by the owner or Accounts, each change audited (`purchase.bill_gst`).
-- One column with a default; order_app gets UPDATE on that column only. Older code ignores it.
alter table order_capture.purchase_bills
  add column gst_bill boolean not null default false;

grant update (gst_bill) on order_capture.purchase_bills to order_app;
