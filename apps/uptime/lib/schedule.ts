import { getStore } from "@probes/core/server";
import type { Json } from "@probes/core";
import { runChecks } from "./monitor.ts";
import type { CheckRunResult, Severity } from "./monitor.ts";

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
  brand?: { name: string; color: string };
  /** Newest first, capped. */
  history?: HistoryEntry[];
};

/** Roughly a fortnight of daily checks — enough to see a trend, small to store. */
export const MAX_HISTORY = 14;

/**
 * How long a monitor set keeps being re-checked without anyone opening it.
 * Anonymous sets are cheap to create, so without this the scheduler would
 * grow unboundedly and hammer domains nobody is watching any more.
 */
export const STALE_AFTER_DAYS = 30;

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
  failed: { id: string; error: string }[];
  startedAt: string;
  finishedAt: string;
};

/**
 * Re-check every monitor set that is still live, oldest first so nothing
 * starves. Runs sets sequentially: the point is to be a good citizen toward
 * the domains being checked, not to finish fast.
 */
export async function runScheduledChecks(now: Date = new Date()): Promise<ScheduleReport> {
  const startedAt = now.toISOString();
  const store = getStore();
  const artifacts = await store.listArtifacts("uptime", 200);

  const cutoff = now.getTime() - STALE_AFTER_DAYS * 86_400_000;
  const report: ScheduleReport = {
    considered: artifacts.length,
    refreshed: 0,
    skippedStale: 0,
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
      const merged: MonitorSet = {
        ...next,
        brand: previous.brand,
        history: appendHistory(previous, next),
      };
      await store.saveArtifact({
        id: artifact.id,
        probe: "uptime",
        sessionId: artifact.sessionId,
        payload: merged as unknown as Json,
        createdAt: artifact.createdAt,
      });
      report.refreshed += 1;
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
