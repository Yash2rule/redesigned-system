import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_RECIPIENTS_PER_MESSAGE,
  RecordingTransport,
  ResendTransport,
  emailConfigured,
  plainTextEmail,
  sendEach,
  sendEmail,
  setEmailTransport,
  unsubscribeFooter,
} from "./index.ts";

/**
 * The promise this package exists to keep: with no key, nothing is sent and
 * the caller is told so. It never silently succeeds and it never throws into
 * a cron run or a visitor's request.
 */

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "AUTH_FROM_EMAIL"]) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  setEmailTransport(null);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("with no key configured", () => {
  it("reports itself unconfigured", () => {
    expect(emailConfigured()).toBe(false);
    expect(new ResendTransport().isConfigured()).toBe(false);
  });

  it("returns not-configured rather than pretending to send", async () => {
    const result = await sendEmail({ to: ["a@b.com"], subject: "x", text: "y" });
    expect(result.status).toBe("not-configured");
    if (result.status !== "not-configured") throw new Error("unreachable");
    expect(result.reason).toContain("RESEND_API_KEY");
  });

  it("says a key without a from address is still not configured", async () => {
    process.env.RESEND_API_KEY = "re_test";
    const result = await sendEmail({ to: ["a@b.com"], subject: "x", text: "y" });
    expect(result.status).toBe("not-configured");
    if (result.status !== "not-configured") throw new Error("unreachable");
    expect(result.reason).toContain("EMAIL_FROM");
  });

  it("makes sendEach report it, so callers can tell the user", async () => {
    const result = await sendEach(["a@b.com", "c@d.com"], () => ({ subject: "x", text: "y" }));
    expect(result).toEqual({ sent: 0, failed: 0, notConfigured: true, failures: [] });
  });
});

describe("guard rails", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "hello@example.com";
  });

  it("refuses an empty recipient list", async () => {
    const result = await sendEmail({ to: [], subject: "x", text: "y" });
    expect(result.status).toBe("failed");
  });

  it("refuses a blast larger than the cap rather than leaking a list", async () => {
    const many = Array.from({ length: MAX_RECIPIENTS_PER_MESSAGE + 1 }, (_, i) => `u${i}@e.com`);
    const result = await sendEmail({ to: many, subject: "x", text: "y" });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.reason).toContain("batches");
  });

  it("never throws, even when the transport does", async () => {
    setEmailTransport({
      name: "broken",
      isConfigured: () => true,
      async send() {
        throw new Error("network on fire");
      },
    });
    const result = await sendEmail({ to: ["a@b.com"], subject: "x", text: "y" });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("unreachable");
    expect(result.reason).toContain("network on fire");
  });
});

describe("sendEach", () => {
  it("sends one message per recipient, never a shared To: header", async () => {
    const transport = new RecordingTransport();
    setEmailTransport(transport);

    await sendEach(["a@b.com", "c@d.com", "e@f.com"], (recipient) => ({
      subject: "Weekly check",
      text: `Hello ${recipient}`,
    }));

    expect(transport.sent).toHaveLength(3);
    // A shared To: would leak the whole list to everyone on it.
    for (const message of transport.sent) expect(message.to).toHaveLength(1);
    expect(transport.sent[0]?.text).toContain("a@b.com");
  });

  it("counts failures without aborting the rest", async () => {
    let call = 0;
    setEmailTransport({
      name: "flaky",
      isConfigured: () => true,
      async send(message) {
        call += 1;
        return call === 2
          ? { status: "failed", reason: "bounced", recipients: 1 }
          : { status: "sent", provider: "resend", id: "x", recipients: message.to.length };
      },
    });
    const result = await sendEach(["a@b.com", "c@d.com", "e@f.com"], () => ({
      subject: "x",
      text: "y",
    }));
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toContain("c@d.com");
  });
});

describe("plainTextEmail", () => {
  it("wraps without breaking words", () => {
    const text = plainTextEmail({
      paragraphs: ["word ".repeat(40).trim()],
    });
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(72);
    expect(text).not.toContain("wor\nd");
  });

  it("renders bullets and links readably", () => {
    const text = plainTextEmail({
      greeting: "Hello,",
      paragraphs: ["Something changed."],
      bullets: ["example.com — certificate expires in 9 days"],
      links: [{ label: "The full status page", url: "https://example.com/s/abc" }],
      signoff: "Thanks.",
    });
    expect(text).toContain("- example.com");
    expect(text).toContain("The full status page:\nhttps://example.com/s/abc");
  });
});

describe("unsubscribeFooter", () => {
  it("says specifically why they are getting this, and how to stop", () => {
    const footer = unsubscribeFooter(
      "You are getting this because you asked Northline Studio to watch these sites.",
      "hello@example.com",
    );
    expect(footer).toContain("Northline Studio");
    expect(footer).toContain("stop");
    expect(footer).toContain("hello@example.com");
  });
});
