-- Products get the HSN code and the purchase rate from Zoho Items (owner, 2026-11-06; docs/ZOHO_IMPORT_PHASE_PLAN.md
-- section 4). Both optional; existing rows read as "not set". HSN goes to modules with the product list (bills show it);
-- the purchase rate stays on the platform (owner only). No grant change: platform_app / platform_super already have
-- SELECT / INSERT / UPDATE on tenant_skus, and there is still no DELETE.
alter table platform.tenant_skus
  add column hsn text check (hsn is null or hsn ~ '^[0-9]{4,8}$'),
  add column cost_rate numeric(12, 2) check (cost_rate is null or (cost_rate >= 0 and cost_rate <= 10000000));
