import { dayReportRoute } from "@plantops/module-kit/day-report";
import { jobsDayReport } from "@/server/day-report";
import { kit } from "@/server/kit";

/** Sales' Day report (owner only): one day's applications. Only with a platform lookup ticket (scope day_report). */
export const GET = dayReportRoute(kit, jobsDayReport);
