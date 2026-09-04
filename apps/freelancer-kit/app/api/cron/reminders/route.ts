import { isAuthorisedCron, runReminders } from "../../../../lib/reminders.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/cron/reminders — send whatever advance-tax reminders are due.
 *
 * Safe to run daily: each due date is mailed exactly once, tracked per
 * reminder. Refuses without CRON_SECRET, because an open endpoint that sends
 * mail is an open endpoint that sends mail.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorisedCron(request)) {
    return Response.json(
      { error: "This endpoint runs on a schedule and needs CRON_SECRET." },
      { status: 401 },
    );
  }

  const report = await runReminders();
  console.log(
    `[freelancer-kit reminders] ${report.sent} sent, ${report.alreadySent} already sent, ` +
      `${report.due} due, ${report.considered} reminders on file`,
  );
  return Response.json(report, { headers: { "cache-control": "no-store" } });
}
