-- Phase 3: "Lab lead" role - a lab technician who can also approve batches, release holds, verify entries
-- and set test limits in Lab Records. Opens the Lab Records module like lab_technician (ROLE_MODULE).
insert into platform.roles (id, module_id, label) values ('lab_lead', 'lab_records', 'Lab lead');
