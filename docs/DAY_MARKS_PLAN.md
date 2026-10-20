# Day marks: owner marks a day ON or OFF (Attendance & Salary, STABILITY_PLAN F1)

**Status:** design agreed with the owner 2026-10-19; **migration `0008_day_marks.sql` approved by the owner
2026-10-19**; **built 2026-10-19 as v0.26.0** (owner: "go for the next one"). Live before the first salary month end
(31 Oct) once deployed.

**Made while building:** a day can be marked **today or earlier** only (the calendar opens past days and today; a
future date is refused), so "mark Sunday OFF" happens on Sunday or after it. People without a salary setting can be
marked too; their calendar shows no ON / OFF colour (it has no day statuses), the day page does.

## Why
The salary rules (v0.20.0) count every day of the month; a day without IN / OUT marks is **absent**, and only 2 paid
leave days cover absences. A worker who works every day except the 4 Sundays of October would lose 2 days' pay. The
owner wants to decide day by day instead of setting weekly-off rules.

## What the owner asked for (2026-10-19)
- The owner marks **one person** on **one date**: **OFF** or **ON**. Any date (Sunday or any other day). No times.
- **No reason**: just a tap. Who and when are still recorded.
- **One person at a time** (no "mark everyone" for a date).
- **OFF is paid for everyone**, per-day people included ("simply a normal day").

## The rules
| Mark | Counts as | Pay |
|---|---|---|
| **ON** | a full **present** day, whatever the IN / OUT marks say | as a present day |
| **OFF** | a **paid day off**: not absent, does **not** use paid leave | monthly: no cut; per day: the day rate |
| **Clear** | back to the IN / OUT marks (present / half / absent by shift hours) | as before |

- The owner's mark decides present / absent for that day; **overtime still comes only from real IN / OUT times**.
- Only days the person is employed and that are over count (rule 1 unchanged); today's mark counts from tomorrow,
  like today's marks. A mark outside the person's Joined on / Last day does nothing.
- **Paid months** stay frozen: a mark changed after payment flows into the next month once, like a fix today.
- New salary rule **20** in `src/lib/salary.ts` (`RULES_VERSION` 5); paid months frozen with an older version read as
  before.

## Who
- **Owner only** (`tenant_admin`). Office staff, Supervisors, Plant staff: no. PlantOps support sees it, read-only.
- **Office staff are unchanged (owner, 2026-10-19):** they keep marking people IN / OUT **with times** ("Mark for
  someone", Fix), as today. Only the owner marks a whole day ON / OFF without times.
- The worker sees "OFF (owner)" / "ON (owner)" on their own calendar and day view. No notification.
- The morning "not marked" alert (Supervisors + owners) leaves out people marked OFF for today.

## Screens
- **Staff → person → calendar / day:** each day gets **ON · OFF · Clear** for the owner (the current choice
  highlighted). Saved at once; "Recent changes" lists "Marked 25 Oct OFF for Ramu".
- **Salary tab, checking panel, slip, CSV:** a new count **"Days off (paid)"** next to present / half / absent;
  ON days are already in "present".

## Database (Attendance migration `0008_day_marks.sql`, needs the owner's OK)
- New table `attendance_salary.day_marks`: `tenant_id`, `user_id` (the person), `day` (date), `mark` ('on' | 'off' |
  'clear'), `by_user_id`, `by_name`, `at`. **Append-only**: `attendance_app` gets SELECT + INSERT only; the latest row
  per person and day wins, so every change stays in the history. `tenant_id` + FORCE RLS like every other table.
- Nothing existing changes. Platform and SSO token unchanged.

## Tests (with the build)
Rule 20 arithmetic (monthly full / part month, per day, with paid leave), ON beating an absent day, OFF beating marks,
Clear, overtime from real marks only, a paid month frozen then "changed after payment", owner-only (Office staff /
Supervisor / Plant staff / support refused), tenant isolation + the FORCE RLS guard, the append-only refusal, the
not-marked alert skipping OFF people, the worker's calendar.

## Added in v0.28.0 (owner, 2026-10-20)
**Mark days** on the person's month: the owner picks several days (up to 31) and marks them all ON / OFF / Clear in
one save (`POST /api/day-marks`); one row and one Recent changes line per day.

## Later (not in v0.26.0)
Marking a date for everyone; weekly-off rules; holiday lists; leave requests from the worker's phone.
