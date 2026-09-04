import type { MonitorResult, Severity } from "./monitor.ts";

/**
 * A summary per client, rather than per monitor set.
 *
 * An agency does not think in monitor sets. It thinks in clients: "is there
 * anything I need to tell Acme about this week?" A set can hold several
 * clients' domains, so the numbers on the status page — 2 critical, 1 warning —
 * are the agency's total and answer nobody's question. These are the numbers
 * you can put in front of one client.
 */

export type ClientSummary = {
  /** null for domains entered without a client heading. */
  client: string | null;
  monitors: MonitorResult[];
  worst: Severity;
  counts: { total: number; critical: number; warning: number; healthy: number };
  /** The findings this client needs told about, worst first. */
  headline: string[];
};

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "ok"];

const worstOf = (severities: Severity[]): Severity =>
  SEVERITY_ORDER.find((s) => severities.includes(s)) ?? "ok";

/**
 * hostname -> client, built from the groups the agency typed. Keyed on the
 * monitor's `input` as well as its hostname, because "acme.com" and
 * "https://acme.com/" are the same monitor entered two ways.
 */
export function clientAssignments(
  groups: { client: string | null; targets: string[] }[],
): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const group of groups) {
    if (!group.client) continue;
    for (const target of group.targets) assignments[target] = group.client;
  }
  return assignments;
}

const clientFor = (
  monitor: MonitorResult,
  assignments: Record<string, string>,
): string | null =>
  assignments[monitor.input.toLowerCase()] ??
  assignments[monitor.hostname.toLowerCase()] ??
  null;

export function summariseByClient(
  monitors: MonitorResult[],
  assignments: Record<string, string>,
): ClientSummary[] {
  const byClient = new Map<string | null, MonitorResult[]>();
  for (const monitor of monitors) {
    const client = clientFor(monitor, assignments);
    const existing = byClient.get(client);
    if (existing) existing.push(monitor);
    else byClient.set(client, [monitor]);
  }

  const summaries: ClientSummary[] = [];
  for (const [client, group] of byClient) {
    const findings = group.flatMap((m) => m.findings);
    summaries.push({
      client,
      monitors: group,
      worst: worstOf(group.map((m) => m.worst)),
      counts: {
        total: group.length,
        critical: group.filter((m) => m.worst === "critical").length,
        warning: group.filter((m) => m.worst === "warning").length,
        healthy: group.filter((m) => m.worst === "ok" || m.worst === "info").length,
      },
      headline: SEVERITY_ORDER.flatMap((severity) =>
        findings.filter((f) => f.severity === severity).map((f) => f.title),
      ).slice(0, 5),
    });
  }

  // Worst first, so the client you need to email is at the top; then by name,
  // so the order does not shuffle between runs. Unassigned domains go last —
  // they are the agency's own, not a client's.
  return summaries.sort((a, b) => {
    if (a.client === null) return 1;
    if (b.client === null) return -1;
    const bySeverity =
      SEVERITY_ORDER.indexOf(a.worst) - SEVERITY_ORDER.indexOf(b.worst);
    if (bySeverity !== 0) return bySeverity;
    return a.client.localeCompare(b.client);
  });
}

/** True when the agency actually named any clients — otherwise don't group. */
export const hasClients = (assignments: Record<string, string>): boolean =>
  Object.keys(assignments).length > 0;
