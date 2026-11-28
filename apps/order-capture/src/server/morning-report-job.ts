// The 8:30 am morning report (owner 2026-11-28, P5-b / P5-c): POST /api/cron/morning-report (cron-job.org row 15). For
// each plant with Plant answers switched on (PLANT_ANSWERS_PLANTS, D9): save today's report once, then one notification
// to the plant's OWNERS only (only_listed + their ids). Safe to run twice: the report is saved once per day and the
// notification has a dedupe key, so a second run adds nothing.
import { morningSummary } from "@/lib/answers/rank";
import { istToday } from "./cash";
import { env } from "./env";
import { kit } from "./kit";
import { saveMorning } from "./morning-report";

export async function runMorningReport(now = new Date(), plants: () => Promise<string[]> = async () => env.plantAnswersPlants) {
  const date = istToday(now);
  let made = 0;
  let sent = 0;
  const skipped: { tenant: string; why: string }[] = [];
  for (const t of await plants()) {
    try {
      const { created, report } = await saveMorning(t, now);
      if (created) made++;
      const owners = ((await kit.contacts(t)) ?? []).filter((c) => c.roles.includes("tenant_admin")).map((c) => c.user_id);
      if (!owners.length) {
        skipped.push({ tenant: t, why: "no owners found (or PlantOps unreachable)" });
        continue;
      }
      const { title, body } = morningSummary({ actions: report.actions, leftOut: [] });
      await kit.notify(t, {
        kind: "order_capture.morning_report",
        title,
        body,
        link: `/reports/answers/morning?d=${report.date}`,
        level: "push",
        dedupe_key: `morning_report:${report.date}`,
        also_user_ids: owners,
        only_listed: true,
      });
      sent++;
    } catch (err) {
      console.error("morning report failed", t, err);
      skipped.push({ tenant: t, why: "error" });
    }
  }
  return { date, made, sent, skipped };
}
