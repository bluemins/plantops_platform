-- Phase 4: Document Store module (licences and certificates with expiry reminders) and its staff role.
insert into platform.modules (id, name) values ('document_store', 'Document Store');
insert into platform.roles (id, module_id, label) values ('document_keeper', 'document_store', 'Document keeper');
