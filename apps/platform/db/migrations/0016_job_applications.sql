-- Job applications module (public job page + the plant's list of applicants) and its staff role.
-- Plan: docs/JOB_APPLICATIONS_PHASE_PLAN.md. Plant staff do NOT work in it (not in PLANT_STAFF_MODULES).
insert into platform.modules (id, name) values ('job_applications', 'Job applications');
insert into platform.roles (id, module_id, label) values ('hr_desk', 'job_applications', 'HR desk');
