import { isAuthorisedCron, runScheduledChecks } from "../../../../lib/schedule.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/check — refresh every live monitor set.
 *
 * Wired to a daily cron in vercel.json. Refuses to run without CRON_SECRET:
 * this endpoint makes outbound requests to arbitrary domains, and an open
 * version of it is a request amplifier pointed at other people's servers.
 */
export async function GET(request: Request): Promise<Response> {
  if (!isAuthorisedCron(request)) {
    return new Response(
      JSON.stringify({
        error:
          "This endpoint runs on a schedule and needs CRON_SECRET. It is not open, because it makes outbound requests to third-party domains.",
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  const report = await runScheduledChecks();
  console.log(
    `[uptime cron] refreshed ${report.refreshed}/${report.considered} sets, ` +
      `${report.skippedStale} stale, ${report.failed.length} failed`,
  );

  return new Response(JSON.stringify(report), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
