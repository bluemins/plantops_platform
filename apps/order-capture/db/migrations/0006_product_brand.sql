-- Brand per product (owner, 2026-11-01): a tag on each order card ("Bluemins", "Mr.Charge"), brand chips above the list
-- and brand totals in the owner's pending summary. Set by the owner on Rates next to the unit and default rate.
--   null = not set: the brand is guessed from the product name (the words before the size, src/lib/brand.ts)
--   ''   = no brand: no tag for this product
-- Nothing else changes; order_app gets UPDATE on this one column like unit / default_rate (still no DELETE).
alter table order_capture.product_rates
  add column brand text check (brand is null or (brand = trim(brand) and length(brand) <= 30));
grant update (brand) on order_capture.product_rates to order_app;
