import { dayReportRoute } from "@plantops/module-kit/day-report";
import { stockDayReport } from "@/server/day-report";
import { kit } from "@/server/kit";

/** Sales' Day report (owner only): one day's count. Only with a platform lookup ticket (scope day_report). */
export const GET = dayReportRoute(kit, stockDayReport);
