-- "Plant staff" role: general plant worker, not tied to one module. Works in every module the plant has
-- enabled (with that module's normal staff rights) except Lab Records, which stays with lab technicians and
-- lab leads. The rule lives in roleWorksIn() (packages/types); module_id is null like tenant_admin.
insert into platform.roles (id, module_id, label) values ('plant_staff', null, 'Plant staff');
