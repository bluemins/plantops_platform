-- Complaint Box module (customer complaints with photos / video, follow-up and resolve) and its staff role.
-- Plan: docs/COMPLAINT_BOX_PHASE_PLAN.md. Plant staff work in it too (roleWorksIn); it is not in PLANT_STAFF_EXCLUDED.
insert into platform.modules (id, name) values ('complaint_box', 'Complaint Box');
insert into platform.roles (id, module_id, label) values ('complaint_desk', 'complaint_box', 'Complaint desk');
