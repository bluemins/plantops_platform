-- GST basics for bills (owner, 2026-11-07; docs/BILL_FIELDS_PHASE_PLAN.md, approved): the plant's own GSTIN on Business
-- details (its first two digits are the plant's GST state: same state = CGST + SGST, another = IGST) and a GST rate per
-- product, set by the owner on Products (the Zoho items import never touches it: Zoho's item rates were out of date).
-- Both optional; existing rows read as "not set". The app also checks the GSTIN's check character. No grant change:
-- platform_app / platform_super already have SELECT / INSERT / UPDATE on both tables, and there is still no DELETE.
alter table platform.tenant_profiles
  add column gstin text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');

alter table platform.tenant_skus
  add column gst_rate numeric(5, 2) check (gst_rate in (0, 5, 12, 18, 28, 40));
