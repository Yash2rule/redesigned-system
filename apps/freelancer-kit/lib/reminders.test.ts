import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordingTransport, setEmailTransport } from "@probes/email";
import { getStore } from "@probes/core/server";
import { resetRateLimits } from "@probes/app-kit";
import { jsonRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as remindRoute } from "../app/api/remind/route.ts";
import { GET as cronRoute } from "../app/api/cron/reminders/route.ts";
import { computeAdvanceTax } from "./advance-tax.ts";
import {
  REMIND_DAYS_BEFORE,
  buildReminder,
  isAuthorisedCron,
  reminderEmail,
  REMINDER_SCOPE,
  runReminders,
  saveReminder,
} from "./reminders.ts";

/**
 * A missed instalment costs 1% a month. The behaviour that matters is that a
 * reminder arrives once, before the date, and never again for that date.
 */

let store: ReturnType<typeof useTempStore>;
let mail: RecordingTransport;

const result = () =>
  computeAdvanceTax({
    grossReceiptsMinor: 40_00_000 * 100,
    expensesMinor: 0,
    otherIncomeMinor: 0,
    basis: "actual-books",
    regime: "new",
    deductionsMinor: 0,
    tdsDeductedMinor: 0,
    alreadyPaidMinor: 0,
  });

beforeEach(() => {
  store = useTempStore();
  mail = new RecordingTransport();
  setEmailTransport(mail);
});
afterEach(() => {
  setEmailTransport(null);
  store.cleanup();
});

describe("buildReminder", () => {
  it("keeps only instalments worth reminding about", () => {
    const reminder = buildReminder("a@b.com", result());
    expect(reminder.instalments.length).toBeGreaterThan(0);
    // Reminding someone about a payment of zero is worse than silence.
    expect(reminder.instalments.every((i) => i.instalmentMinor > 0)).toBe(true);
    expect(reminder.sentFor).toEqual([]);
  });

  it("normalises the email", () => {
    expect(buildReminder("  Asha@Example.COM ", result()).email).toBe("asha@example.com");
  });
});

describe("reminderEmail", () => {
  it("names the amount, the date and the cost of missing it", () => {
    const reminder = buildReminder("a@b.com", result());
    const instalment = reminder.instalments[0];
    const message = reminderEmail(reminder, instalment!);

    expect(message.subject).toContain(instalment!.dueDate);
    expect(message.text).toContain("234C");
    expect(message.text).toContain("e-Pay Tax");
    // The estimate is from whenever they set it; say so.
    expect(message.text).toContain("recompute");
  });

  it("tells a 44ADA filer there are no other instalments", () => {
    const presumptive = computeAdvanceTax({
      grossReceiptsMinor: 40_00_000 * 100,
      expensesMinor: 0,
      otherIncomeMinor: 0,
      basis: "presumptive-44ada",
      regime: "new",
      deductionsMinor: 0,
      tdsDeductedMinor: 0,
      alreadyPaidMinor: 0,
    });
    const reminder = buildReminder("a@b.com", presumptive);
    const message = reminderEmail(reminder, reminder.instalments[0]!);
    expect(message.text).toContain("no June, September or December instalments");
  });
});

describe("runReminders", () => {
  /** A reminder whose only due date is `days` from `now`. */
  async function reminderDueIn(days: number, now: Date): Promise<void> {
    const dueDate = new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    const base = buildReminder("asha@example.com", result());
    await saveReminder({
      ...base,
      instalments: [
        {
          dueDate,
          label: "Test instalment",
          cumulativePct: 100,
          cumulativeMinor: 50_000_00,
          instalmentMinor: 50_000_00,
          status: "upcoming",
          daysAway: days,
        },
      ],
    });
  }

  it("sends nothing when the date is still far off", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    await reminderDueIn(REMIND_DAYS_BEFORE + 20, now);
    const report = await runReminders(now);
    expect(report.sent).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("sends once inside the window", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    await reminderDueIn(REMIND_DAYS_BEFORE - 2, now);

    const first = await runReminders(now);
    expect(first.sent).toBe(1);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toEqual(["asha@example.com"]);
  });

  it("does NOT send again the next day", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    await reminderDueIn(REMIND_DAYS_BEFORE - 2, now);

    await runReminders(now);
    const second = await runReminders(new Date(now.getTime() + 86_400_000));
    // A daily cron must not mail the same person every morning for a week.
    expect(second.sent).toBe(0);
    expect(second.alreadySent).toBe(1);
    expect(mail.sent).toHaveLength(1);
  });

  it("says nothing about a date that has already passed", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    await reminderDueIn(-5, now);
    const report = await runReminders(now);
    expect(report.sent).toBe(0);
    expect(report.expired).toBe(1);
  });

  it("reports that email is off rather than marking the date as done", async () => {
    setEmailTransport({
      name: "off",
      isConfigured: () => false,
      async send() {
        throw new Error("must not be called");
      },
    });
    const now = new Date("2026-01-01T00:00:00Z");
    await reminderDueIn(REMIND_DAYS_BEFORE - 2, now);

    const report = await runReminders(now);
    expect(report.notConfigured).toBe(true);
    expect(report.sent).toBe(0);

    // Crucially, the date was NOT recorded as sent — so once a key is added,
    // the reminder still goes out.
    setEmailTransport(mail);
    const after = await runReminders(now);
    expect(after.sent).toBe(1);
  });

  it("ignores artifacts that are not reminders", async () => {
    await getStore().saveArtifact({
      id: "an-invoice",
      probe: "freelancer-kit",
      sessionId: null,
      payload: { kind: "invoice", result: {} } as never,
      createdAt: new Date().toISOString(),
    });
    const report = await runReminders(new Date("2026-01-01T00:00:00Z"));
    expect(report.considered).toBe(0);
  });
});

describe("POST /api/remind", () => {
  // The limiter is module state shared by every test in this process.
  beforeEach(() => resetRateLimits());

  const payload = {
    grossReceipts: 4000000,
    basis: "actual-books",
    regime: "new",
    email: "asha@example.com",
  };

  it("stores a reminder and returns the due dates", async () => {
    const response = await remindRoute(jsonRequest("http://localhost/api/remind", payload));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { dueDates: string[]; live: boolean };
    expect(body.dueDates.length).toBeGreaterThan(0);
    // The recording transport installed for these tests IS configured, so the
    // route should say so — it reports the real state, not a fixed value.
    expect(body.live).toBe(true);
  });

  it("reports live:false when email is genuinely not configured", async () => {
    // Never let someone believe they are covered when they are not.
    setEmailTransport({
      name: "off",
      isConfigured: () => false,
      async send() {
        throw new Error("must not be called");
      },
    });
    const response = await remindRoute(jsonRequest("http://localhost/api/remind", payload));
    const body = (await response.json()) as { dueDates: string[]; live: boolean };
    expect(body.live).toBe(false);
    // The reminder is still stored, so it fires once a key is added.
    expect(body.dueDates.length).toBeGreaterThan(0);
  });

  it("refuses a bad address", async () => {
    const response = await remindRoute(
      jsonRequest("http://localhost/api/remind", { ...payload, email: "nope" }),
    );
    expect(response.status).toBe(400);
  });

  it("refuses when no advance tax is actually payable", async () => {
    const response = await remindRoute(
      jsonRequest("http://localhost/api/remind", { ...payload, grossReceipts: 500000 }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("nothing to remind");
  });

  it("recomputes server-side rather than trusting a client schedule", async () => {
    const response = await remindRoute(
      jsonRequest("http://localhost/api/remind", {
        ...payload,
        basis: "presumptive-44ada",
        instalments: [{ dueDate: "2099-01-01", instalmentMinor: 1 }],
      }),
    );
    const body = (await response.json()) as { dueDates: string[] };
    // 44ADA has one date, and it is not 2099.
    expect(body.dueDates).toHaveLength(1);
    expect(body.dueDates[0]).toBe("2026-03-15");
  });
});

describe("the reminders cron", () => {
  it("refuses without CRON_SECRET", async () => {
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const request = new Request("http://localhost/api/cron/reminders");
      expect(isAuthorisedCron(request)).toBe(false);
      expect((await cronRoute(request)).status).toBe(401);
    } finally {
      if (saved !== undefined) process.env.CRON_SECRET = saved;
    }
  });

  it("runs with the right bearer token", async () => {
    process.env.CRON_SECRET = "a-long-enough-cron-secret";
    try {
      const response = await cronRoute(
        new Request("http://localhost/api/cron/reminders", {
          headers: { authorization: "Bearer a-long-enough-cron-secret" },
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()) as { considered: number }).toHaveProperty("considered");
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

describe("reminders are stored where the scan will always find them", () => {
  it("is filed apart from invoices and contracts", async () => {
    // They used to share the "freelancer-kit" scope with every document the
    // probe produces. The daily scan reads the newest 500 rows of a scope, so
    // once enough invoices existed the older reminders fell off the end and
    // were never sent — silently, which is the worst way for a reminder to
    // fail. Separate scopes mean documents can never crowd reminders out.
    const store = getStore();
    const id = await saveReminder(buildReminder("asha@example.com", result()));

    await store.saveArtifact({
      id: "an-invoice",
      probe: "freelancer-kit",
      sessionId: null,
      payload: { kind: "invoice" } as never,
      createdAt: new Date().toISOString(),
    });

    const documents = await store.listArtifacts("freelancer-kit", 500);
    const reminders = await store.listArtifacts(REMINDER_SCOPE, 500);

    expect(documents.map((a) => a.id)).toContain("an-invoice");
    expect(documents.map((a) => a.id)).not.toContain(id);
    expect(reminders.map((a) => a.id)).toEqual([id]);
  });

  it("stays in its own scope after being marked as sent", async () => {
    // Writing it back under a different scope would hide it from the next
    // scan, and the same person would be mailed every morning forever.
    const id = await saveReminder(buildReminder("asha@example.com", result()));
    await runReminders(new Date());
    const reminders = await getStore().listArtifacts(REMINDER_SCOPE, 500);
    expect(reminders.map((a) => a.id)).toEqual([id]);
  });
});

describe("POST /api/remind is rate limited", () => {
  beforeEach(() => resetRateLimits());

  it("stops one address registering reminders without limit", async () => {
    // The only endpoint where a stranger can make us mail an address of their
    // choosing, from the domain we had to verify in order to send at all.
    // Unlimited, it is a spam relay wearing our return address, and the cost
    // lands on our sending reputation rather than theirs.
    const send = (n: number) =>
      remindRoute(
        jsonRequest(
          "http://localhost/api/remind",
          {
            grossReceipts: 4000000,
            basis: "actual-books",
            regime: "new",
            email: `person${n}@example.com`,
          },
          { "x-forwarded-for": "203.0.113.77" },
        ),
      );

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) statuses.push((await send(i)).status);

    // The first few land; the rest are refused.
    expect(statuses.filter((status) => status === 200).length).toBe(5);
    expect(statuses.filter((status) => status === 429).length).toBe(2);

    const blocked = await send(99);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("keys on the forwarded IP, so dropping a cookie does not reset it", async () => {
    const post = (ip: string) =>
      remindRoute(
        jsonRequest(
          "http://localhost/api/remind",
          { grossReceipts: 4000000, basis: "actual-books", regime: "new", email: "a@b.co" },
          { "x-forwarded-for": ip },
        ),
      );
    for (let i = 0; i < 5; i += 1) await post("198.51.100.9");
    expect((await post("198.51.100.9")).status).toBe(429);
    // A different caller is unaffected.
    expect((await post("198.51.100.10")).status).toBe(200);
  });
});
