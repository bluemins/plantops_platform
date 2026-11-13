-- B-26 (owner, 2026-11-13; "Bill settings" chosen, migration approved): the salesperson every GST bill carries in the
-- Zoho invoices file ("Download for Zoho"), e.g. "Dillip", typed once on Rates → Bill settings. Empty = each bill's own
-- salesperson, as before. The name must be one Zoho knows as a salesperson. One column on bill_settings; nothing else.
alter table order_capture.bill_settings
  add column gst_salesperson text check (gst_salesperson is null or length(gst_salesperson) between 1 and 100);

grant update (gst_salesperson) on order_capture.bill_settings to order_app;
