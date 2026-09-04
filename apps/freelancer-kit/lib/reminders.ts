import { randomUUID } from "node:crypto";
import { getStore } from "@probes/core/server";
import type { Json } from "@probes/core";
import { formatInr } from "@probes/core";
import { plainTextEmail, sendEach, unsubscribeFooter } from "@probes/email";
import { config } from "./config.ts";
import type { AdvanceTaxResult, Instalment } from "./advance-tax.ts";

/**
 * Reminding a freelancer before an advance-tax due date.
 *
 * This is the one feature here with a number attached to failing: a missed
 * instalment costs 1% a month under section 234C. The insight the product is
 * marketed on — that section 44ADA has one due date, not four — is only worth
 * anything if someone actually acts on it, and nobody remembers 15 March in
 * December.
 *
 * Three rules:
 *
 * 1. One reminder per due date, ever. A tracked `sentFor` list means a cron
 *    that runs daily does not mail the same person every morning for a week.
 * 2. Nothing is sent for a date that has passed, or for an instalment of zero.
 *    Reminding someone about a payment they do not owe is worse than silence.
 * 3. The email restates the amount and the assumption behind it, because an
 *    estimate from April is stale by March and the person needs to know that.
 */

export const REMINDER_KIND = "tax-reminder";

/**
 * Reminders are filed in their own artifact scope rather than alongside
 * invoices and contracts. `listArtifacts` reads the newest N rows for a scope,
 * so sharing one with the document artifacts meant that once enough documents
 * existed the older reminders dropped off the end of the daily scan and were
 * never sent — a reminder that silently stops arriving being worse than one
 * never offered.
 */
export const REMINDER_SCOPE = "freelancer-kit-reminder";

/** How many days ahead of a due date the reminder goes out. */
export const REMIND_DAYS_BEFORE = 10;

export type TaxReminder = {
  kind: typeof REMINDER_KIND;
  email: string;
  financialYear: string;
  basis: AdvanceTaxResult["basis"];
  instalments: Instalment[];
  /** Due dates already mailed, so a daily cron sends each one exactly once. */
  sentFor: string[];
  createdAt: string;
};

export function buildReminder(
  email: string,
  result: AdvanceTaxResult,
): TaxReminder {
  return {
    kind: REMINDER_KIND,
    email: email.trim().toLowerCase(),
    financialYear: result.financialYear,
    basis: result.basis,
    // Only instalments worth reminding about.
    instalments: result.instalments.filter((instalment) => instalment.instalmentMinor > 0),
    sentFor: [],
    createdAt: new Date().toISOString(),
  };
}

export async function saveReminder(reminder: TaxReminder): Promise<string> {
  const id = randomUUID();
  await getStore().saveArtifact({
    id,
    probe: REMINDER_SCOPE,
    sessionId: null,
    payload: reminder as unknown as Json,
    createdAt: reminder.createdAt,
  });
  return id;
}

export function reminderEmail(
  reminder: TaxReminder,
  instalment: Instalment,
): { subject: string; text: string } {
  const daysAway = Math.max(0, instalment.daysAway);
  const single = reminder.basis === "presumptive-44ada";

  return {
    subject: `Advance tax due ${instalment.dueDate} — ${formatInr(instalment.instalmentMinor)}`,
    text: [
      plainTextEmail({
        paragraphs: [
          `Your next advance tax instalment is due on ${instalment.dueDate}, ${daysAway === 0 ? "today" : `in ${daysAway} days`}.`,
          single
            ? "You are taxed under section 44ADA, so this is the whole year's advance tax in one payment. There are no June, September or December instalments for you."
            : `This is the ${instalment.label.toLowerCase()} — ${instalment.cumulativePct}% of the year's liability should be paid by this date.`,
          "Pay it on the income tax portal under 'e-Pay Tax'. Missing the date costs 1% a month in interest under section 234C.",
        ],
        bullets: [
          `Amount for this instalment: ${formatInr(instalment.instalmentMinor)}`,
          `Cumulative by this date: ${formatInr(instalment.cumulativeMinor)} (${instalment.cumulativePct}%)`,
          `Financial year: ${reminder.financialYear}`,
        ],
        signoff:
          "This figure came from what you entered when you set the reminder. If your income has changed since, recompute — advance tax is charged on what you actually earn, not on what you projected.",
      }),
      "",
      unsubscribeFooter(
        `You are getting this because you asked ${config.name} to remind you before your advance tax due dates.`,
        config.contactEmail,
      ),
    ].join("\n"),
  };
}

export type ReminderReport = {
  considered: number;
  due: number;
  sent: number;
  alreadySent: number;
  expired: number;
  notConfigured: boolean;
  failures: string[];
};

function isReminder(payload: unknown): payload is TaxReminder {
  return (
    typeof payload === "object" &&
    payload !== null &&
    (payload as TaxReminder).kind === REMINDER_KIND &&
    typeof (payload as TaxReminder).email === "string" &&
    Array.isArray((payload as TaxReminder).instalments)
  );
}

/**
 * Send whatever is due. Safe to run daily: each due date is mailed once.
 */
export async function runReminders(now: Date = new Date()): Promise<ReminderReport> {
  const store = getStore();
  const artifacts = await store.listArtifacts(REMINDER_SCOPE, 500);
  const report: ReminderReport = {
    considered: 0,
    due: 0,
    sent: 0,
    alreadySent: 0,
    expired: 0,
    notConfigured: false,
    failures: [],
  };

  for (const artifact of artifacts) {
    if (!isReminder(artifact.payload)) continue;
    const reminder = artifact.payload;
    report.considered += 1;

    const today = now.toISOString().slice(0, 10);
    // A reminder whose last date has passed has nothing left to say.
    const last = reminder.instalments[reminder.instalments.length - 1]?.dueDate;
    if (last && last < today) {
      report.expired += 1;
      continue;
    }

    const windowEnd = new Date(now.getTime() + REMIND_DAYS_BEFORE * 86_400_000)
      .toISOString()
      .slice(0, 10);

    for (const instalment of reminder.instalments) {
      // Not yet in the window, or already gone by.
      if (instalment.dueDate > windowEnd || instalment.dueDate < today) continue;
      report.due += 1;

      if (reminder.sentFor.includes(instalment.dueDate)) {
        report.alreadySent += 1;
        continue;
      }

      const { subject, text } = reminderEmail(reminder, {
        ...instalment,
        daysAway: Math.round(
          (Date.parse(`${instalment.dueDate}T00:00:00Z`) - now.getTime()) / 86_400_000,
        ),
      });
      const result = await sendEach([reminder.email], () => ({ subject, text }));

      if (result.notConfigured) {
        report.notConfigured = true;
        continue;
      }
      if (result.sent === 0) {
        report.failures.push(`${artifact.id.slice(0, 8)}: ${result.failures.join(", ")}`);
        continue;
      }

      report.sent += 1;
      // Record it immediately, so a crash mid-run cannot double-send.
      await store.saveArtifact({
        id: artifact.id,
        // Same scope it was read from — writing it back under a different one
        // would hide it from the next scan and mail the same person forever.
        probe: REMINDER_SCOPE,
        sessionId: artifact.sessionId,
        payload: {
          ...reminder,
          sentFor: [...reminder.sentFor, instalment.dueDate],
        } as unknown as Json,
        createdAt: artifact.createdAt,
      });
      reminder.sentFor.push(instalment.dueDate);
    }
  }

  return report;
}

/** Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations. */
export function isAuthorisedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}
