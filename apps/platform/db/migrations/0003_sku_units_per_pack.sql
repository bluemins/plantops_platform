-- Products sold in multi-unit packs, e.g. a case of 24 x 500 ml bottles.
-- volume_ml stays the size of ONE unit (one bottle/jar/pouch); units_per_pack is how many units the SKU holds
-- (1 for a single bottle or jar).
alter table platform.tenant_skus
  add column units_per_pack int not null default 1 check (units_per_pack between 1 and 1000);
