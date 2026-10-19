# PlantOps modules and user roles

This page is a quick reference to the ten PlantOps modules and the user roles currently supported by the platform.
A plant user can hold more than one role. Module access is also subject to the plant's enabled modules and is
enforced by the module server.

## Modules and basic usage

| Module | Basic usage | Plant role / access |
|---|---|---|
| Lab Records | Record batches and test results, track pass/fail, manage holds and approvals, and maintain compliance forms. | Lab technician; Lab lead has additional approval, hold-release, verification and limit-setting permissions. |
| Document Store | Store plant licences and certificates, track expiry and renewals, and manage responsible people and files. | Document keeper. |
| Floor Stock | Record daily production and closing stock, review calculated sold/used quantities, and identify low stock. | Store keeper. |
| Complaint Box | Log customer complaints, attach evidence, follow up, and track resolution. | Complaint desk; resolving and reopening are owner-only. |
| Order Capture | Record customer orders and manage delivery and cancellation. | Order desk; Plant staff may view orders without amounts, but cannot make changes. |
| Preventive Management | Manage plant assets, preventive-maintenance schedules, task completion and maintenance history. | Maintenance technician. |
| AMC | Manage annual maintenance contracts, service visits, renewals and invoicing. | No AMC-specific plant operating role is currently defined in the platform. |
| Attendance & Salary | Record attendance and overtime, manage salary and claims, and support attendance desk and supervisor workflows. | Plant staff, Office staff and Supervisor; owners manage plant-wide settings and salary. |
| Job Applications | Publish plant job openings and receive and manage applicant records. | HR desk; applicants use the public application page without a PlantOps account. |
| Marketing Contacts | Manage marketing contacts and follow-ups. | No Marketing Contacts-specific plant role is currently defined in the platform. A Sales team role is planned, but is not yet supported. |

## Supported users and roles

The platform has global and plant-level users. Plant-level roles are assigned per plant; a user may have several
roles at the same plant.

| Scope | Supported user / role | Basic role |
|---|---|---|
| Platform-wide | Super admin (`super_admin`) | Manages plants, tenant admins, plans and module enablement; can access supported module data in audited, read-only support mode. |
| Plant-wide | Owner (`tenant_admin`) | Owns/manages the plant, its users and settings; receives owner access and summaries across enabled modules. |
| Plant module | Lab technician (`lab_technician`) | Enters Lab Records data and performs technician workflows. |
| Plant module | Lab lead (`lab_lead`) | Performs technician work and can approve batches, release holds, verify records and set limits. |
| Plant module | Document keeper (`document_keeper`) | Manages plant documents and certificates in Document Store. |
| Plant module | Store keeper (`store_keeper`) | Sets up and records Floor Stock data within the permissions for that role. |
| Plant module | Complaint desk (`complaint_desk`) | Logs and follows up complaints in Complaint Box. |
| Plant module | Order desk (`order_desk`) | Enters and manages orders in Order Capture, within the permissions for that role. |
| Plant-wide employee role | Plant staff (`plant_staff`) | Marks the person as an employee for Attendance & Salary (including their own attendance); also grants view-only Order Capture access without amounts. It does not grant access to other modules by itself. |
| Plant module | Office staff (`office_staff`) | In Attendance & Salary, marks attendance for other people, fixes times and gives advances; cannot see salaries or act for themselves. |
| Plant module | Supervisor (`supervisor`) | In Attendance & Salary, sees the Today board and attendance alerts, and can mark/fix Office staff; tracked as an employee only if also assigned Plant staff. |
| Plant module | HR desk (`hr_desk`) | Sees and follows up job applicants; openings, CSV export and immediate removal are owner-only. |
| External/public | Job applicant (no PlantOps role) | Submits an application through the public job page; has no authenticated access to PlantOps modules. |

### Roles not yet supported

The Marketing Contacts role **Sales team** is planned but is not currently present in the platform's role definitions.
The platform also has no AMC-specific operating role at this time. These are therefore listed as gaps, not as roles
that can currently be assigned.
