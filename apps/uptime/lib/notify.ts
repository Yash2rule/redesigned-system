import { plainTextEmail, sendEach, unsubscribeFooter } from "@probes/email";
import { config } from "./config.ts";
import type { MonitorSet } from "./schedule.ts";
import type { CheckRunResult, Severity } from "./monitor.ts";

/**
 * Telling an agency that something changed.
 *
 * The rule that shapes this: only email when the situation actually changed.
 * A monitor that mails "still down" every morning trains people to filter it,
 * and then the one that matters is filtered too. So we diff against the
 * previous check and stay silent when nothing moved.
 */

export type Change = {
  hostname: string;
  from: Severity;
  to: Severity;
  direction: "broke" | "recovered" | "worsened" | "improved";
  summary: string;
};

const RANK: Record<Severity, number> = { ok: 0, info: 1, warning: 2, critical: 3 };

/** What changed between the previous check and this one. */
export function diffChecks(previous: MonitorSet, next: CheckRunResult): Change[] {
  const before = new Map(previous.monitors?.map((m) => [m.hostname, m.worst]) ?? []);
  const changes: Change[] = [];

  for (const monitor of next.monitors) {
    const from = before.get(monitor.hostname);
    // A newly added site is not a change; there is nothing to compare against.
    if (from === undefined || from === monitor.worst) continue;

    const rose = RANK[monitor.worst] > RANK[from];
    const worstFinding = monitor.findings[0];
    changes.push({
      hostname: monitor.hostname,
      from,
      to: monitor.worst,
      direction:
        monitor.worst === "critical" && !rose
          ? "worsened"
          : from === "critical" && !rose
            ? "recovered"
            : rose
              ? RANK[from] === 0
                ? "broke"
                : "worsened"
              : "improved",
      summary: rose
        ? (worstFinding?.title ?? `Now ${monitor.worst}`)
        : `Back to ${monitor.worst === "ok" ? "normal" : monitor.worst}`,
    });
  }

  return changes;
}

export function changeAlertEmail(
  changes: Change[],
  brandName: string,
  statusUrl: string,
): { subject: string; text: string } {
  const broke = changes.filter((c) => c.direction === "broke" || c.direction === "worsened");
  const fixed = changes.filter((c) => c.direction === "recovered" || c.direction === "improved");

  const subject =
    broke.length > 0
      ? `${broke.length === 1 ? broke[0]?.hostname : `${broke.length} sites`} needs attention`
      : `${fixed.length === 1 ? fixed[0]?.hostname : `${fixed.length} sites`} back to normal`;

  const text = [
    plainTextEmail({
      paragraphs: [
        broke.length > 0
          ? "Something changed on the sites you are watching, and it went the wrong way."
          : "Something changed on the sites you are watching, and it went the right way.",
      ],
      bullets: changes.map((change) => `${change.hostname} — ${change.summary}`),
      links: [{ label: "The full status page", url: statusUrl }],
      signoff:
        "You will not get another message about these unless the situation changes again. A site that stays down does not get a daily reminder.",
    }),
    "",
    unsubscribeFooter(
      `You are getting this because you asked ${brandName} to watch these sites.`,
      config.contactEmail,
    ),
  ].join("\n");

  return { subject, text };
}

export function weeklyReportEmail(
  set: MonitorSet,
  brandName: string,
  statusUrl: string,
): { subject: string; text: string } {
  const { summary } = set;
  const attention = set.monitors.filter((m) => m.worst === "critical" || m.worst === "warning");

  const expiring = set.monitors
    .filter((m) => (m.tls?.daysRemaining ?? 999) <= 45 || (m.domain.daysRemaining ?? 999) <= 90)
    .map((m) => {
      const bits: string[] = [];
      if ((m.tls?.daysRemaining ?? 999) <= 45) {
        bits.push(`certificate in ${m.tls?.daysRemaining} days`);
      }
      if ((m.domain.daysRemaining ?? 999) <= 90) {
        bits.push(`domain in ${m.domain.daysRemaining} days`);
      }
      return `${m.hostname} — ${bits.join(", ")}`;
    });

  return {
    subject:
      summary.critical > 0
        ? `Weekly check: ${summary.critical} of ${summary.total} sites need attention`
        : `Weekly check: all ${summary.total} sites healthy`,
    text: [
      plainTextEmail({
        paragraphs: [
          summary.critical > 0
            ? `${summary.critical} of ${summary.total} sites need attention, ${summary.warning} are worth watching.`
            : `All ${summary.total} sites responded normally this week.`,
        ],
        ...(attention.length > 0
          ? {
              bullets: attention.map(
                (m) => `${m.hostname} — ${m.findings[0]?.title ?? m.worst}`,
              ),
            }
          : {}),
        links: [{ label: "The full status page", url: statusUrl }],
      }),
      expiring.length > 0
        ? `\nExpiring soon:\n${expiring.map((line) => `- ${line}`).join("\n")}`
        : "",
      "",
      unsubscribeFooter(
        `You are getting this because you asked ${brandName} to watch these sites.`,
        config.contactEmail,
      ),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Send change alerts for one monitor set. Silent when nothing changed. */
export async function notifyChanges(
  set: MonitorSet & { alertEmails?: string[] },
  changes: Change[],
  statusUrl: string,
): Promise<{ sent: number; skipped: string }> {
  const recipients = set.alertEmails ?? [];
  if (changes.length === 0) return { sent: 0, skipped: "nothing changed" };
  if (recipients.length === 0) return { sent: 0, skipped: "no alert address on this monitor set" };

  const brandName = set.brand?.name?.trim() || config.name;
  const { subject, text } = changeAlertEmail(changes, brandName, statusUrl);
  const result = await sendEach(recipients, () => ({ subject, text }));

  return {
    sent: result.sent,
    skipped: result.notConfigured ? "email is not configured on this deployment" : "",
  };
}

/** Send the weekly summary for one monitor set. */
export async function sendWeeklyReport(
  set: MonitorSet & { alertEmails?: string[] },
  statusUrl: string,
): Promise<{ sent: number; skipped: string }> {
  const recipients = set.alertEmails ?? [];
  if (recipients.length === 0) return { sent: 0, skipped: "no address on this monitor set" };

  const brandName = set.brand?.name?.trim() || config.name;
  const { subject, text } = weeklyReportEmail(set, brandName, statusUrl);
  const result = await sendEach(recipients, () => ({ subject, text }));

  return {
    sent: result.sent,
    skipped: result.notConfigured ? "email is not configured on this deployment" : "",
  };
}
