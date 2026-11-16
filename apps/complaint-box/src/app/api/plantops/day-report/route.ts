import { dayReportRoute } from "@plantops/module-kit/day-report";
import { complaintDayReport } from "@/server/day-report";
import { kit } from "@/server/kit";

/** Sales' Day report (owner only): one day's complaints. Only with a platform lookup ticket (scope day_report). */
export const GET = dayReportRoute(kit, complaintDayReport);
