-- super_admin "Modules" screen: set a module's URL, issue a new client secret, switch it off for all plants.
-- Only these three columns; the module list itself (ids, names) still comes from migrations.
grant update (base_url, client_secret_hash, status) on platform.modules to platform_super;
