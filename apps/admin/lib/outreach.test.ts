import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RecordingTransport, setEmailTransport } from "@probes/email";
import { getStore } from "@probes/core/server";
import { useTempStore } from "../../../tests/helpers.ts";
import { buildAudience, intentsCsv, runOutreach } from "./outreach.ts";

/**
 * This code mails strangers who trusted a one-person product with an address.
 * The tests are mostly about what it refuses to do.
 */

let store: ReturnType<typeof useTempStore>;
let mail: RecordingTransport;

const intent = (probe: string, email: string, plan = "single") => ({
  id: `${probe}-${email}-${plan}`,
  sessionId: "s",
  probe: probe as never,
  email,
  plan,
  amountMinor: 19900,
  currency: "INR" as const,
  note: null,
  createdAt: new Date().toISOString(),
});

beforeEach(async () => {
  store = useTempStore();
  mail = new RecordingTransport();
  setEmailTransport(mail);
  for (const row of [
    intent("offer-decoder", "a@example.com"),
    intent("offer-decoder", "b@example.com"),
    intent("ledger", "a@example.com"), // same person, second probe
    intent("ledger", "c@example.com"),
    intent("uptime", "D@Example.com"), // different case, same as none above
  ]) {
    await getStore().saveIntent(row);
  }
});
afterEach(() => {
  setEmailTransport(null);
  store.cleanup();
});

const base = {
  subject: "Payments are open",
  body: "You left your email asking to be told when you could pay. You can now.",
  productName: "Offer Decoder",
  contactEmail: "hello@example.com",
};

describe("buildAudience", () => {
  it("de-duplicates a person who left their email on several probes", async () => {
    const audience = await buildAudience("all");
    expect(audience.recipients).toHaveLength(4);
    expect(audience.duplicatesRemoved).toBe(1);
    expect(audience.recipients.filter((e) => e === "a@example.com")).toHaveLength(1);
  });

  it("normalises case, so one person is one recipient", async () => {
    const audience = await buildAudience("all");
    expect(audience.recipients).toContain("d@example.com");
    expect(audience.recipients).not.toContain("D@Example.com");
  });

  it("filters to one probe when asked", async () => {
    const audience = await buildAudience("ledger");
    expect(audience.recipients.sort()).toEqual(["a@example.com", "c@example.com"]);
  });

  it("treats an unknown probe as everyone rather than silently mailing nobody", async () => {
    expect((await buildAudience("nonsense")).probe).toBe("all");
  });
});

describe("runOutreach", () => {
  it("sends nothing without the typed confirmation", async () => {
    const result = await runOutreach({ ...base, probe: "all", confirm: false });
    expect(result.dryRun).toBe(true);
    expect(result.sent).toBe(0);
    expect(mail.sent).toHaveLength(0);
    // But it must show exactly who and exactly what.
    expect(result.recipientCount).toBe(4);
    expect(result.sample.length).toBeGreaterThan(0);
    expect(result.preview.text).toContain("You can now");
  });

  it("sends one message each once confirmed", async () => {
    const result = await runOutreach({ ...base, probe: "all", confirm: true });
    expect(result.dryRun).toBe(false);
    expect(result.sent).toBe(4);
    expect(mail.sent).toHaveLength(4);
    for (const message of mail.sent) expect(message.to).toHaveLength(1);
  });

  it("always appends why they are receiving it and how to stop", async () => {
    const result = await runOutreach({ ...base, probe: "all", confirm: true });
    expect(result.preview.text).toContain("you left your email on Offer Decoder");
    expect(result.preview.text).toContain("stop");
    expect(result.preview.text).toContain("hello@example.com");
  });

  it("reports that email is off rather than appearing to have sent", async () => {
    setEmailTransport({
      name: "unconfigured",
      isConfigured: () => false,
      async send() {
        throw new Error("must not be called");
      },
    });
    const result = await runOutreach({ ...base, probe: "all", confirm: true });
    expect(result.notConfigured).toBe(true);
    expect(result.sent).toBe(0);
  });

  it("mails only the chosen probe's list", async () => {
    await runOutreach({ ...base, probe: "ledger", confirm: true });
    expect(mail.sent.map((m) => m.to[0]).sort()).toEqual(["a@example.com", "c@example.com"]);
  });
});

describe("intentsCsv", () => {
  it("has a header and one row per intent", async () => {
    const audience = await buildAudience("all");
    const lines = intentsCsv(audience.intents).split("\n");
    expect(lines[0]).toBe("created_at,probe,email,plan,amount_minor,currency,note");
    expect(lines).toHaveLength(audience.intents.length + 1);
  });

  it("escapes a field that would otherwise break the file", () => {
    const csv = intentsCsv([
      { ...intent("ledger", "x@y.com"), note: 'said "yes, please", twice' },
    ]);
    expect(csv).toContain('"said ""yes, please"", twice"');
    // One header line plus exactly one data line — the comma did not split it.
    expect(csv.split("\n")).toHaveLength(2);
  });
});
