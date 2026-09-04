import { env } from "@probes/core";

/**
 * Sending email, behind one interface.
 *
 * The rule this package exists to enforce: with no RESEND_API_KEY, nothing is
 * sent and every caller is told so explicitly. It does not silently succeed,
 * and it does not throw into a cron run or a visitor's request. A product that
 * promises "we'll email you when payments open" and quietly drops the message
 * is worse than one that never offered.
 */

export type EmailMessage = {
  to: string[];
  subject: string;
  /** Plain text. Every message here is text — no tracking pixels, no HTML. */
  text: string;
  replyTo?: string;
};

export type SendResult =
  | { status: "sent"; provider: "resend"; id: string | null; recipients: number }
  /** No key configured. Nothing was sent, and the caller must say so. */
  | { status: "not-configured"; reason: string; recipients: number }
  | { status: "failed"; reason: string; recipients: number };

export interface EmailTransport {
  readonly name: string;
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<SendResult>;
}

export const MAX_RECIPIENTS_PER_MESSAGE = 50;

export class ResendTransport implements EmailTransport {
  readonly name = "resend";

  isConfigured(): boolean {
    return Boolean(env.resendApiKey && this.from());
  }

  private from(): string | undefined {
    return process.env.EMAIL_FROM?.trim() || process.env.AUTH_FROM_EMAIL?.trim();
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const apiKey = env.resendApiKey;
    const from = this.from();
    const recipients = message.to.length;

    if (!apiKey || !from) {
      return {
        status: "not-configured",
        reason: !apiKey
          ? "RESEND_API_KEY is not set, so no email was sent."
          : "EMAIL_FROM is not set, so no email was sent.",
        recipients,
      };
    }
    if (recipients === 0) {
      return { status: "failed", reason: "No recipients.", recipients: 0 };
    }
    if (recipients > MAX_RECIPIENTS_PER_MESSAGE) {
      return {
        status: "failed",
        reason: `${recipients} recipients in one message; the cap is ${MAX_RECIPIENTS_PER_MESSAGE}. Send in batches.`,
        recipients,
      };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });

      if (!response.ok) {
        return {
          status: "failed",
          reason: `Resend returned ${response.status}: ${(await response.text()).slice(0, 200)}`,
          recipients,
        };
      }
      const body = (await response.json()) as { id?: string };
      return { status: "sent", provider: "resend", id: body.id ?? null, recipients };
    } catch (error) {
      return { status: "failed", reason: (error as Error).message, recipients };
    }
  }
}

/** Records messages instead of sending them. Used by tests and by dry runs. */
export class RecordingTransport implements EmailTransport {
  readonly name = "recording";
  readonly sent: EmailMessage[] = [];

  isConfigured(): boolean {
    return true;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    this.sent.push(message);
    return {
      status: "sent",
      provider: "resend",
      id: `recorded-${this.sent.length}`,
      recipients: message.to.length,
    };
  }
}

let override: EmailTransport | null = null;

export function setEmailTransport(transport: EmailTransport | null): void {
  override = transport;
}

export function getEmailTransport(): EmailTransport {
  return override ?? new ResendTransport();
}

export function emailConfigured(): boolean {
  return getEmailTransport().isConfigured();
}

/**
 * Send one message.
 *
 * Never throws. Callers get a result they must handle — including the
 * not-configured case, which they are expected to surface rather than hide.
 */
export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  try {
    return await getEmailTransport().send(message);
  } catch (error) {
    return {
      status: "failed",
      reason: (error as Error).message,
      recipients: message.to.length,
    };
  }
}

/**
 * Send the same message to many people, one message each.
 *
 * One-per-recipient rather than a bcc blast: these are transactional messages
 * to people who asked for them, and a shared To: header would leak the whole
 * list to everyone on it.
 */
export async function sendEach(
  recipients: string[],
  build: (recipient: string) => Omit<EmailMessage, "to">,
): Promise<{ sent: number; failed: number; notConfigured: boolean; failures: string[] }> {
  const transport = getEmailTransport();
  if (!transport.isConfigured()) {
    return { sent: 0, failed: 0, notConfigured: true, failures: [] };
  }

  let sent = 0;
  let failed = 0;
  const failures: string[] = [];
  for (const recipient of recipients) {
    const result = await sendEmail({ ...build(recipient), to: [recipient] });
    if (result.status === "sent") sent += 1;
    else {
      failed += 1;
      if (failures.length < 10) failures.push(`${recipient}: ${result.status}`);
    }
  }
  return { sent, failed, notConfigured: false, failures };
}
