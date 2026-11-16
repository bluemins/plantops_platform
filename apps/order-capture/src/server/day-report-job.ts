// The evening Day report notification (owner 2026-11-16): POST /api/cron/day-report at 21:00 IST (cron-job.org). One
// notification per plant per day, to the plant's OWNERS only (only_listed + their ids: never ticked Sales staff, the
// report has attendance and money). Plants: those that have started a cash book (cash_tenants(); a plant's list of ids
// needs a database function, and that one exists). Tapping it opens Reports → Day report for that date.
import { dayNotificationText } from "@/lib/day-report";
import { istToday } from "./cash";
import { cashTenantIds } from "./cash-tenants";
import { dayReport, reader } from "./day-report";
import { kit } from "./kit";

export async function runDayReport(now = new Date(), plants: () => Promise<string[]> = cashTenantIds) {
  const date = istToday(now);
  let sent = 0;
  const skipped: { tenant: string; why: string }[] = [];
  for (const t of await plants()) {
    try {
      const owners = ((await kit.contacts(t)) ?? []).filter((c) => c.roles.includes("tenant_admin")).map((c) => c.user_id);
      if (!owners.length) {
        skipped.push({ tenant: t, why: "no owners found (or PlantOps unreachable)" });
        continue;
      }
      const { title, body } = dayNotificationText(await dayReport(reader(t), date, now));
      await kit.notify(t, {
        kind: "order_capture.day_report",
        title,
        body,
        link: `/reports/day?d=${date}`,
        level: "push",
        dedupe_key: `day_report:${date}`,
        also_user_ids: owners,
        only_listed: true,
      });
      sent++;
    } catch (err) {
      console.error("day report failed", t, err);
      skipped.push({ tenant: t, why: "error" });
    }
  }
  return { date, plants: sent, skipped };
}
