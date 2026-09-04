import { getStore } from "@probes/core/server";
import type { Json } from "@probes/core";
import { runChecks } from "./monitor.ts";
import type { CheckRunResult, Severity } from "./monitor.ts";
import { diffChecks, notifyChanges, sendWeeklyReport } from "./notify.ts";
import type { Brand } from "./brand.ts";

/**
 * Scheduled re-checks.
 *
 * A monitor set is just an artifact: the domains an agency entered, their
 * brand, the last full result, and a short history. Re-checking rewrites the
 * same artifact id, so the status page link an agency has already sent a
 * client keeps working and starts showing fresh data.
 */

export type HistoryEntry = {
  checkedAt: string;
  /** hostname -> worst severity at that moment. */
  worst: Record<string, Severity>;
  critical: number;
  warning: number;
};

export type MonitorSet = CheckRunResult & {
  brand?: Brand;
  /**
   * hostname -> client name, from the "# Client" headings in the textarea.
   * Absent or empty means the agency did not name any, which is the common
   * case; the status page then shows one flat list as it always did.
   */
  clients?: Record<string, string>;
  /** Newest first, capped. */
  history?: HistoryEntry[];
  /** Where to send change alerts. Empty means the owner did not ask for any. */
  alertEmails?: string[];
  /** When the weekly summary last went out, so it goes out weekly not daily. */
  lastWeeklyReportAt?: string;
};

/** Roughly a fortnight of daily checks — enough to see a trend, small to store. */
export const MAX_HISTORY = 14;

/**
 * How long a monitor set keeps being re-checked without anyone opening it.
 * Anonymous sets are cheap to create, so without this the scheduler would
 * grow unboundedly and hammer domains nobody is watching any more.
 */
export const STALE_AFTER_DAYS = 30;

/** A weekly report means weekly, even though the checker runs daily. */
export const WEEKLY_REPORT_INTERVAL_MS = 7 * 86_400_000;

/** How many sets one scheduled invocation will refresh. */
export const MAX_SETS_PER_RUN = 25;

export function appendHistory(previous: MonitorSet, next: CheckRunResult): HistoryEntry[] {
  const entry: HistoryEntry = {
    checkedAt: next.checkedAt,
    worst: Object.fromEntries(next.monitors.map((m) => [m.hostname, m.worst])),
    critical: next.summary.critical,
    warning: next.summary.warning,
  };
  return [entry, ...(previous.history ?? [])].slice(0, MAX_HISTORY);
}

export type ScheduleReport = {
  considered: number;
  refreshed: number;
  skippedStale: number;
  /** Change alerts actually delivered this run. */
  alertsSent: number;
  /** Sets where something changed but no alert could be sent, and why. */
  alertsSkipped: string[];
  /** Weekly summaries delivered this run. */
  weeklyReportsSent: number;
  failed: { id: string; error: string }[];
  startedAt: string;
  finishedAt: string;
};

/**
 * Re-check every monitor set that is still live, oldest first so nothing
 * starves. Runs sets sequentially: the point is to be a good citizen toward
 * the domains being checked, not to finish fast.
 */
export async function runScheduledChecks(
  now: Date = new Date(),
  baseUrl = process.env.APP_BASE_URL?.trim() || "",
): Promise<ScheduleReport> {
  const startedAt = now.toISOString();
  const store = getStore();
  const artifacts = await store.listArtifacts("uptime", 200);

  const cutoff = now.getTime() - STALE_AFTER_DAYS * 86_400_000;
  const report: ScheduleReport = {
    considered: artifacts.length,
    refreshed: 0,
    skippedStale: 0,
    alertsSent: 0,
    alertsSkipped: [],
    weeklyReportsSent: 0,
    failed: [],
    startedAt,
    finishedAt: startedAt,
  };

  const live = artifacts.filter((artifact) => {
    const set = artifact.payload as unknown as MonitorSet;
    const lastSeen = Date.parse(set.checkedAt ?? artifact.createdAt);
    if (!Number.isFinite(lastSeen) || lastSeen < cutoff) {
      report.skippedStale += 1;
      return false;
    }
    return true;
  });

  // Oldest check first, so a set never goes unrefreshed for long.
  live.sort((a, b) => {
    const at = (a.payload as unknown as MonitorSet).checkedAt ?? a.createdAt;
    const bt = (b.payload as unknown as MonitorSet).checkedAt ?? b.createdAt;
    return at.localeCompare(bt);
  });

  for (const artifact of live.slice(0, MAX_SETS_PER_RUN)) {
    const previous = artifact.payload as unknown as MonitorSet;
    const targets = previous.monitors?.map((m) => m.input).filter(Boolean) ?? [];
    if (targets.length === 0) continue;

    try {
      const next = await runChecks(targets);
      const statusUrl = `${baseUrl}/s/${artifact.id}`;

      // The weekly summary goes out at most once every seven days, even though
      // this runs daily. A "weekly" report arriving every morning is a daily
      // report nobody asked for.
      const lastWeekly = previous.lastWeeklyReportAt
        ? Date.parse(previous.lastWeeklyReportAt)
        : 0;
      const weeklyDue =
        (previous.alertEmails?.length ?? 0) > 0 &&
        now.getTime() - lastWeekly >= WEEKLY_REPORT_INTERVAL_MS;

      const merged: MonitorSet = {
        ...next,
        brand: previous.brand,
        alertEmails: previous.alertEmails,
        history: appendHistory(previous, next),
        lastWeeklyReportAt: previous.lastWeeklyReportAt,
      };
      await store.saveArtifact({
        id: artifact.id,
        probe: "uptime",
        sessionId: artifact.sessionId,
        payload: merged as unknown as Json,
        createdAt: artifact.createdAt,
      });
      report.refreshed += 1;

      // Only mail when the situation actually changed. A monitor that says
      // "still down" every morning trains people to filter it, and then the
      // one that matters gets filtered too.
      const changes = diffChecks(previous, next);
      if (changes.length > 0) {
        const outcome = await notifyChanges(merged, changes, statusUrl);
        report.alertsSent += outcome.sent;
        if (outcome.skipped) report.alertsSkipped.push(`${artifact.id.slice(0, 8)}: ${outcome.skipped}`);
      }

      if (weeklyDue) {
        const outcome = await sendWeeklyReport(merged, statusUrl);
        report.weeklyReportsSent += outcome.sent;
        // Record the send only when something actually went out, so an
        // unconfigured deployment does not silently burn the week's slot.
        if (outcome.sent > 0) {
          await store.saveArtifact({
            id: artifact.id,
            probe: "uptime",
            sessionId: artifact.sessionId,
            payload: { ...merged, lastWeeklyReportAt: now.toISOString() } as unknown as Json,
            createdAt: artifact.createdAt,
          });
        }
      }
    } catch (error) {
      // One bad set must not stop the rest of the schedule.
      report.failed.push({ id: artifact.id, error: (error as Error).message });
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations.
 *
 * With no secret set the endpoint refuses everything rather than running: this
 * route makes outbound requests to arbitrary domains, so an open version of it
 * is a request amplifier pointed at other people's servers.
 */
export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}
