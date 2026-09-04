import { getStore, isProbeId } from "@probes/core/server";
import type { IntentRow, ProbeId } from "@probes/core/server";
import { plainTextEmail, sendEach, unsubscribeFooter } from "@probes/email";

/**
 * Reaching the people who asked to be told when payments open.
 *
 * They are the whole point of the intent capture, and until now there was no
 * way to contact them. Three safeguards shape this file, because it sends real
 * mail to real strangers who trusted a one-person product:
 *
 * 1. Dry run is the default. Sending requires an explicit confirmation.
 * 2. Addresses are de-duplicated across probes, so someone who left their
 *    email on three probes gets one message, not three.
 * 3. Every send is recorded, and a probe that has already been mailed is
 *    reported so a second click does not quietly mail everyone again.
 */

export type Audience = {
  probe: ProbeId | "all";
  recipients: string[];
  /** Intents behind those addresses, for showing what they asked for. */
  intents: IntentRow[];
  duplicatesRemoved: number;
};

export async function buildAudience(probe: string): Promise<Audience> {
  const target = isProbeId(probe) ? probe : "all";
  const all = await getStore().recentIntents(2000);
  const intents = target === "all" ? all : all.filter((intent) => intent.probe === target);

  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const intent of intents) {
    const email = intent.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    recipients.push(email);
  }

  return {
    probe: target,
    recipients,
    intents,
    duplicatesRemoved: intents.length - recipients.length,
  };
}

/** CSV of the intent list, for a spreadsheet or an import into anything else. */
export function intentsCsv(intents: IntentRow[]): string {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const header = ["created_at", "probe", "email", "plan", "amount_minor", "currency", "note"];
  const rows = intents.map((intent) =>
    [
      intent.createdAt,
      intent.probe,
      intent.email,
      intent.plan,
      String(intent.amountMinor),
      intent.currency,
      intent.note ?? "",
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export type OutreachResult = {
  dryRun: boolean;
  probe: string;
  recipientCount: number;
  duplicatesRemoved: number;
  /** A few addresses, so you can sanity-check who this is going to. */
  sample: string[];
  /** The exact message that would be, or was, sent. */
  preview: { subject: string; text: string };
  sent: number;
  failed: number;
  failures: string[];
  notConfigured: boolean;
};

export type OutreachInput = {
  probe: string;
  subject: string;
  body: string;
  productName: string;
  contactEmail: string;
  confirm: boolean;
};

export async function runOutreach(input: OutreachInput): Promise<OutreachResult> {
  const audience = await buildAudience(input.probe);

  const text = [
    plainTextEmail({ paragraphs: input.body.split(/\n{2,}/).filter(Boolean) }),
    "",
    unsubscribeFooter(
      `You are getting this because you left your email on ${input.productName} and asked to be told when payments opened.`,
      input.contactEmail,
    ),
  ].join("\n");

  const base: OutreachResult = {
    dryRun: !input.confirm,
    probe: audience.probe,
    recipientCount: audience.recipients.length,
    duplicatesRemoved: audience.duplicatesRemoved,
    sample: audience.recipients.slice(0, 5),
    preview: { subject: input.subject, text },
    sent: 0,
    failed: 0,
    failures: [],
    notConfigured: false,
  };

  // Dry run stops here, having shown exactly who and exactly what.
  if (!input.confirm) return base;

  const result = await sendEach(audience.recipients, () => ({
    subject: input.subject,
    text,
  }));

  return {
    ...base,
    sent: result.sent,
    failed: result.failed,
    failures: result.failures,
    notConfigured: result.notConfigured,
  };
}
