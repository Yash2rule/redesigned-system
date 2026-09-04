import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecordingTransport, setEmailTransport } from "@probes/email";
import { getStore } from "@probes/core/server";
import { useTempStore } from "../../../tests/helpers.ts";
import { runChecks } from "./monitor.ts";
import { runScheduledChecks } from "./schedule.ts";

/**
 * The alert promise, end to end against a real server: you hear when something
 * changes, and only then.
 *
 * A monitor that mails "still down" every morning gets filtered, and then the
 * one that matters gets filtered too. So the third run below — the one that
 * must send nothing — is the most important assertion in this file.
 */

process.env.UPTIME_ALLOW_PRIVATE_HOSTS = "1";

let store: ReturnType<typeof useTempStore>;
let mail: RecordingTransport;
let server: ReturnType<typeof createServer>;
let target: string;
let healthy = true;

beforeAll(async () => {
  store = useTempStore();
  mail = new RecordingTransport();
  setEmailTransport(mail);
  process.env.APP_BASE_URL = "https://clientwatch.example";

  server = createServer((_req, res) => {
    if (healthy) {
      res.statusCode = 200;
      res.setHeader("strict-transport-security", "max-age=31536000");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", "frame-ancestors 'self'");
      res.end("ok");
    } else {
      res.statusCode = 503;
      res.end("down");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  target = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  const first = await runChecks([target]);
  await getStore().saveArtifact({
    id: "set-alert",
    probe: "uptime",
    sessionId: "s1",
    payload: {
      ...first,
      brand: { name: "Northline Studio", color: "#0f766e" },
      alertEmails: ["ops@northline.example"],
      history: [],
      // As the check route sets it: the weekly clock starts at creation.
      lastWeeklyReportAt: new Date().toISOString(),
    } as never,
    createdAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  setEmailTransport(null);
  store.cleanup();
  delete process.env.APP_BASE_URL;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the alert lifecycle", () => {
  it("sends nothing when nothing changed", async () => {
    const report = await runScheduledChecks();
    expect(report.refreshed).toBe(1);
    expect(report.alertsSent).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it("sends exactly one message when a site breaks", async () => {
    healthy = false;
    const report = await runScheduledChecks();

    expect(report.alertsSent).toBe(1);
    expect(mail.sent).toHaveLength(1);

    const message = mail.sent[0];
    expect(message?.to).toEqual(["ops@northline.example"]);
    expect(message?.subject).toContain("needs attention");
    // The link has to be absolute or it is useless inside an email.
    expect(message?.text).toContain("https://clientwatch.example/s/set-alert");
    expect(message?.text).toContain("Northline Studio");
    expect(message?.text).toContain("stop");
  });

  it("does NOT send a second message while the site stays down", async () => {
    const report = await runScheduledChecks();
    expect(report.alertsSent).toBe(0);
    expect(mail.sent).toHaveLength(1);
  });

  it("sends one more when it recovers", async () => {
    healthy = true;
    const report = await runScheduledChecks();
    expect(report.alertsSent).toBe(1);
    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[1]?.subject).toContain("back to normal");
  });

  it("records why an alert could not be sent, rather than failing silently", async () => {
    await getStore().saveArtifact({
      id: "set-no-address",
      probe: "uptime",
      sessionId: "s2",
      payload: {
        ...(await runChecks([target])),
        alertEmails: [],
        history: [],
      } as never,
      createdAt: new Date().toISOString(),
    });
    healthy = false;
    const report = await runScheduledChecks();
    healthy = true;
    expect(report.alertsSkipped.join(" ")).toContain("no alert address");
  });
});

describe("the weekly summary", () => {
  it("does not arrive the day after someone read the results on screen", async () => {
    const report = await runScheduledChecks(new Date(Date.now() + 86_400_000));
    expect(report.weeklyReportsSent).toBe(0);
  });

  it("arrives a week later, and then not again until the week after", async () => {
    const { WEEKLY_REPORT_INTERVAL_MS } = await import("./schedule.ts");
    const week = Date.now() + WEEKLY_REPORT_INTERVAL_MS + 1000;
    const before = mail.sent.length;

    let report = await runScheduledChecks(new Date(week));
    expect(report.weeklyReportsSent).toBeGreaterThanOrEqual(1);
    expect(mail.sent.length).toBeGreaterThan(before);
    expect(mail.sent[mail.sent.length - 1]?.subject).toContain("Weekly check");

    // The next day is not a new week. A "weekly" report arriving daily is a
    // daily report nobody asked for.
    report = await runScheduledChecks(new Date(week + 86_400_000));
    expect(report.weeklyReportsSent).toBe(0);
  });

  it("names what needs attention in the subject", async () => {
    const { weeklyReportEmail } = await import("./notify.ts");
    const healthySet = {
      checkedAt: new Date().toISOString(),
      monitors: [{ hostname: "a.com", worst: "ok", findings: [], tls: null, domain: {} }],
      summary: { total: 3, critical: 0, warning: 0, healthy: 3 },
      limitations: [],
    } as never;
    expect(weeklyReportEmail(healthySet, "Northline", "https://x/s/1").subject).toContain(
      "all 3 sites healthy",
    );

    const brokenSet = {
      checkedAt: new Date().toISOString(),
      monitors: [
        {
          hostname: "a.com",
          worst: "critical",
          findings: [{ id: "down", severity: "critical", title: "Not responding", detail: "", action: "" }],
          tls: null,
          domain: {},
        },
      ],
      summary: { total: 3, critical: 1, warning: 0, healthy: 2 },
      limitations: [],
    } as never;
    const broken = weeklyReportEmail(brokenSet, "Northline", "https://x/s/1");
    expect(broken.subject).toContain("1 of 3 sites need attention");
    expect(broken.text).toContain("Not responding");
  });

  it("calls out anything expiring soon", async () => {
    const { weeklyReportEmail } = await import("./notify.ts");
    const set = {
      checkedAt: new Date().toISOString(),
      monitors: [
        {
          hostname: "a.com",
          worst: "warning",
          findings: [],
          tls: { daysRemaining: 12 },
          domain: { daysRemaining: 40 },
        },
      ],
      summary: { total: 1, critical: 0, warning: 1, healthy: 0 },
      limitations: [],
    } as never;
    const message = weeklyReportEmail(set, "Northline", "https://x/s/1");
    expect(message.text).toContain("Expiring soon");
    expect(message.text).toContain("certificate in 12 days");
    expect(message.text).toContain("domain in 40 days");
  });
})
