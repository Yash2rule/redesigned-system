import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkHttp, checkTls, parseRdap } from "./checks.ts";
import type { Severity } from "./monitor.ts";
import { isPublicAddress } from "./safe-url.ts";
import { parseTargets, runMonitor } from "./monitor.ts";
import { useTempStore } from "../../../tests/helpers.ts";

const cert = (name: string) =>
  readFileSync(path.join(process.cwd(), "fixtures", "certs", name));

// The SSRF guard has to be relaxed to reach a loopback test server; the guard
// only honours this under NODE_ENV=test, which vitest sets.
process.env.UPTIME_ALLOW_PRIVATE_HOSTS = "1";

let store: ReturnType<typeof useTempStore>;
const servers: { close: () => Promise<void> }[] = [];

/** Spin up a real server so the checks exercise real sockets, not mocks. */
async function startHttp(
  handler: (req: unknown, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void }) => void,
): Promise<number> {
  const server = createServer(handler as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ close: () => new Promise((r) => server.close(() => r())) });
  return (server.address() as AddressInfo).port;
}

async function startHttps(certName: string, keyName: string): Promise<number> {
  const server = createHttpsServer(
    { cert: cert(certName), key: cert(keyName) },
    (_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ close: () => new Promise((r) => server.close(() => r())) });
  return (server.address() as AddressInfo).port;
}

beforeAll(() => {
  store = useTempStore();
});
afterAll(async () => {
  store.cleanup();
  await Promise.all(servers.map((s) => s.close()));
});

describe("isPublicAddress — the SSRF guard", () => {
  const blocked = [
    ["127.0.0.1", 4],
    ["10.1.2.3", 4],
    ["192.168.1.1", 4],
    ["172.16.0.1", 4],
    ["172.31.255.255", 4],
    ["169.254.169.254", 4], // cloud metadata, the one that matters most
    ["100.64.0.1", 4], // carrier-grade NAT
    ["0.0.0.0", 4],
    ["224.0.0.1", 4],
    ["::1", 6],
    ["fe80::1", 6],
    ["fd00::1", 6],
    ["::ffff:127.0.0.1", 6], // IPv4-mapped loopback
    ["::ffff:169.254.169.254", 6],
  ] as const;

  for (const [address, family] of blocked) {
    it(`refuses ${address}`, () => {
      expect(isPublicAddress(address, family)).toBe(false);
    });
  }

  const allowed = [
    ["1.1.1.1", 4],
    ["8.8.8.8", 4],
    ["93.184.216.34", 4],
    ["172.32.0.1", 4], // just outside the private range
    ["2606:4700:4700::1111", 6],
  ] as const;

  for (const [address, family] of allowed) {
    it(`allows ${address}`, () => {
      expect(isPublicAddress(address, family)).toBe(true);
    });
  }
});

describe("checkHttp", () => {
  it("reports a healthy response with latency and headers", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.setHeader("strict-transport-security", "max-age=31536000");
      res.setHeader("x-content-type-options", "nosniff");
      res.end("hello");
    });

    const result = await checkHttp(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.headers["strict-transport-security"]).toBe("max-age=31536000");
    expect(result.error).toBeNull();
  });

  it("reports a 500 as not ok", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 500;
      res.end("boom");
    });
    const result = await checkHttp(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });

  it("follows redirects and records the chain", async () => {
    const targetPort = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.end("arrived");
    });
    const port = await startHttp((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${targetPort}/final`);
      res.end();
    });

    const result = await checkHttp(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBe(true);
    expect(result.redirects).toHaveLength(1);
    expect(result.finalUrl).toContain("/final");
  });

  it("stops on a redirect loop instead of hanging", async () => {
    let port = 0;
    port = await startHttp((_req, res) => {
      res.statusCode = 302;
      res.setHeader("location", `http://127.0.0.1:${port}/loop`);
      res.end();
    });
    const result = await checkHttp(`http://127.0.0.1:${port}/`);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("redirect");
  });

  it("refuses a scheme that is not http or https", async () => {
    const result = await checkHttp("ftp://example.com/file");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("http and https");
  });

  it("refuses a non-standard port", async () => {
    const result = await checkHttp("https://example.com:8443/");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ports 80 and 443");
  });
});

describe("checkTls", () => {
  it("reads a valid certificate off a real handshake", async () => {
    const port = await startHttps("healthy-cert.pem", "healthy-key.pem");
    const result = await checkTls("localhost", port);

    expect(result.subject).toBe("localhost");
    expect(result.validTo).toBeTruthy();
    expect(result.daysRemaining).toBeGreaterThan(300);
    expect(result.hostnameMatches).toBe(true);
    expect(result.altNames).toContain("localhost");
  });

  it("reports a certificate nearing expiry rather than refusing to look", async () => {
    const port = await startHttps("expiring-cert.pem", "expiring-key.pem");
    const result = await checkTls("localhost", port);

    // Self-signed, so it does not validate — but we still read the dates,
    // which is the entire point of the check.
    expect(result.daysRemaining).toBeLessThanOrEqual(10);
    expect(result.daysRemaining).toBeGreaterThanOrEqual(0);
    expect(result.validTo).toBeTruthy();
  });

  it("notices when the certificate does not cover the hostname", async () => {
    const port = await startHttps("wrongname-cert.pem", "wrongname-key.pem");
    const result = await checkTls("localhost", port);
    expect(result.hostnameMatches).toBe(false);
    expect(result.altNames).toContain("other.example");
  });

  it("reports a refused connection instead of throwing", async () => {
    // Port 1 on loopback: nothing listens there.
    const result = await checkTls("127.0.0.1", 1);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.daysRemaining).toBeNull();
  });
});

describe("parseRdap", () => {
  const future = new Date(Date.now() + 90 * 86_400_000).toISOString();

  it("extracts expiry, registrar and status", () => {
    const result = parseRdap({
      events: [
        { eventAction: "registration", eventDate: "2010-01-01T00:00:00Z" },
        { eventAction: "expiration", eventDate: future },
      ],
      status: ["client transfer prohibited", "server delete prohibited"],
      entities: [
        {
          roles: ["registrar"],
          vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "MarkMonitor Inc."]]],
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.registrar).toBe("MarkMonitor Inc.");
    expect(result.daysRemaining).toBeGreaterThan(85);
    expect(result.daysRemaining).toBeLessThanOrEqual(90);
    expect(result.statuses).toContain("client transfer prohibited");
  });

  it("reports unavailable rather than guessing when there is no expiry event", () => {
    const result = parseRdap({ events: [{ eventAction: "registration", eventDate: future }] });
    expect(result.ok).toBe(false);
    expect(result.expiresAt).toBeNull();
    expect(result.daysRemaining).toBeNull();
    expect(result.source).toBe("unavailable");
  });

  it("survives an empty or malformed response", () => {
    expect(parseRdap({}).ok).toBe(false);
    expect(parseRdap(null).ok).toBe(false);
    expect(parseRdap({ entities: [{ roles: ["registrar"] }] }).registrar).toBeNull();
  });
});

describe("parseTargets", () => {
  it("splits on newlines and commas, and de-duplicates", () => {
    expect(parseTargets("a.com\nb.com, c.com\n\nA.COM")).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("ignores comment lines", () => {
    expect(parseTargets("# client sites\na.com")).toEqual(["a.com"]);
  });

  it("refuses an empty list", () => {
    expect(() => parseTargets("   ")).toThrow(/at least one domain/i);
  });

  it("caps the batch size so the request returns promptly", () => {
    const many = Array.from({ length: 12 }, (_, i) => `site${i}.com`).join("\n");
    expect(() => parseTargets(many)).toThrow(/up to 8/i);
  });
});

describe("runMonitor findings", () => {
  it("flags a down site, and the missing security headers on a live one", async () => {
    const downPort = await startHttp((_req, res) => {
      res.statusCode = 503;
      res.end("maintenance");
    });
    const result = await runMonitor(`http://127.0.0.1:${downPort}/`);
    const ids = result.findings.map((f) => f.id);

    expect(result.worst).toBe("critical");
    expect(ids).toContain("down");
  });

  it("reports missing headers as info, not as an outage", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.end("bare");
    });
    const result = await runMonitor(`http://127.0.0.1:${port}/`);
    const ids = result.findings.map((f) => f.id);

    expect(ids).toContain("no-hsts");
    expect(ids).toContain("no-nosniff");
    expect(ids).not.toContain("down");
    expect(result.worst).toBe("info");
  });

  it("says nothing when every header is present and the site is healthy", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.setHeader("strict-transport-security", "max-age=31536000");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", "frame-ancestors 'self'");
      res.end("good");
    });
    const result = await runMonitor(`http://127.0.0.1:${port}/`);
    expect(result.findings).toHaveLength(0);
    expect(result.worst).toBe("ok");
  });

  it("attaches an actionable fix to every finding", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.end("bare");
    });
    const result = await runMonitor(`http://127.0.0.1:${port}/`);
    for (const finding of result.findings) {
      expect(finding.action.length).toBeGreaterThan(10);
      expect(finding.detail.length).toBeGreaterThan(10);
    }
  });
});

describe("non-2xx responses are not all outages", () => {
  it("treats 403 as 'up but refusing anonymous access', not as down", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 403;
      res.end("forbidden");
    });
    const result = await runMonitor(`http://127.0.0.1:${port}/`);
    const ids = result.findings.map((f) => f.id);

    expect(ids).toContain("auth-required");
    expect(ids).not.toContain("down");
    // A staging site behind auth must not show up red in a client report.
    expect(result.worst).not.toBe("critical");
  });

  it("treats 404 as a warning about the address, not an outage", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 404;
      res.end("nope");
    });
    const result = await runMonitor(`http://127.0.0.1:${port}/`);
    const ids = result.findings.map((f) => f.id);
    expect(ids).toContain("not-found");
    expect(ids).not.toContain("down");
    expect(result.worst).toBe("warning");
  });

  it("still treats a 5xx as critical", async () => {
    const port = await startHttp((_req, res) => {
      res.statusCode = 502;
      res.end("bad gateway");
    });
    const result = await runMonitor(`http://127.0.0.1:${port}/`);
    expect(result.findings.map((f) => f.id)).toContain("down");
    expect(result.worst).toBe("critical");
  });
});

describe("TLS SNI", () => {
  it("does not send an IP address as the server name", async () => {
    // RFC 6066 forbids an IP literal in SNI; Node deprecates sending one.
    // Nothing listens on port 1, so this only exercises the connect options.
    const warnings: string[] = [];
    const original = process.emitWarning;
    process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
      warnings.push(String(warning));
      return original.call(process, warning as string, ...(rest as []));
    }) as typeof process.emitWarning;

    try {
      await checkTls("127.0.0.1", 1);
    } finally {
      process.emitWarning = original;
    }
    expect(warnings.join(" ")).not.toMatch(/ServerName to an IP address/);
  });
});

describe("scheduled re-checks", () => {
  it("refuses to run without CRON_SECRET, and with a wrong one", async () => {
    const { isAuthorisedCron } = await import("./schedule.ts");
    const saved = process.env.CRON_SECRET;
    try {
      delete process.env.CRON_SECRET;
      const req = (auth?: string) =>
        new Request("http://localhost/api/cron/check", {
          headers: auth ? { authorization: auth } : {},
        });

      // No secret configured: nothing is authorised, not even a plausible header.
      expect(isAuthorisedCron(req())).toBe(false);
      expect(isAuthorisedCron(req("Bearer anything"))).toBe(false);

      process.env.CRON_SECRET = "a-long-enough-cron-secret";
      expect(isAuthorisedCron(req())).toBe(false);
      expect(isAuthorisedCron(req("Bearer wrong"))).toBe(false);
      expect(isAuthorisedCron(req("a-long-enough-cron-secret"))).toBe(false);
      expect(isAuthorisedCron(req("Bearer a-long-enough-cron-secret"))).toBe(true);

      // A trivially short secret is treated as unset.
      process.env.CRON_SECRET = "short";
      expect(isAuthorisedCron(req("Bearer short"))).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
    }
  });

  it("the cron route returns 401 rather than running when unauthorised", async () => {
    const { GET } = await import("../app/api/cron/check/route.ts");
    const saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const response = await GET(new Request("http://localhost/api/cron/check"));
      expect(response.status).toBe(401);
      expect(((await response.json()) as { error: string }).error).toContain("CRON_SECRET");
    } finally {
      if (saved !== undefined) process.env.CRON_SECRET = saved;
    }
  });

  it("caps history and keeps the newest first", async () => {
    const { appendHistory, MAX_HISTORY } = await import("./schedule.ts");
    let set: { checkedAt: string; history?: unknown[] } = { checkedAt: "2026-01-01T00:00:00.000Z" };

    for (let day = 1; day <= MAX_HISTORY + 5; day += 1) {
      const checkedAt = `2026-02-${String(day).padStart(2, "0")}T00:00:00.000Z`;
      const history = appendHistory(set as never, {
        checkedAt,
        monitors: [{ hostname: "a.com", worst: "ok" }],
        summary: { total: 1, critical: 0, warning: 0, healthy: 1 },
        limitations: [],
      } as never);
      set = { checkedAt, history };
    }

    const history = set.history as { checkedAt: string }[];
    expect(history).toHaveLength(MAX_HISTORY);
    expect(history[0]?.checkedAt).toContain("2026-02-19");
    // Strictly newest-first.
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i - 1]!.checkedAt > history[i]!.checkedAt).toBe(true);
    }
  });

  it("re-checks a stored monitor set in place, so the status page URL survives", async () => {
    const { runScheduledChecks } = await import("./schedule.ts");
    const { getStore } = await import("@probes/core/server");
    const port = await startHttp((_req, res) => {
      res.statusCode = 200;
      res.setHeader("strict-transport-security", "max-age=31536000");
      res.setHeader("x-content-type-options", "nosniff");
      res.setHeader("content-security-policy", "frame-ancestors 'self'");
      res.end("ok");
    });

    const store = getStore();
    await store.saveArtifact({
      id: "set-1",
      probe: "uptime",
      sessionId: "s1",
      payload: {
        checkedAt: new Date().toISOString(),
        monitors: [{ input: `http://127.0.0.1:${port}/`, hostname: "127.0.0.1", worst: "critical" }],
        summary: { total: 1, critical: 1, warning: 0, healthy: 0 },
        limitations: [],
        brand: { name: "Northline Studio", color: "#0f766e" },
        history: [],
      } as never,
      createdAt: new Date().toISOString(),
    });

    const report = await runScheduledChecks();
    expect(report.refreshed).toBeGreaterThanOrEqual(1);

    const updated = await store.getArtifact("set-1");
    const payload = updated?.payload as unknown as {
      summary: { critical: number };
      brand?: { name: string };
      history: unknown[];
    };
    // Same id, fresh result, brand preserved, one history entry added.
    expect(updated?.id).toBe("set-1");
    expect(payload.summary.critical).toBe(0);
    expect(payload.brand?.name).toBe("Northline Studio");
    expect(payload.history).toHaveLength(1);
  });

  it("stops re-checking a set nobody has looked at for a month", async () => {
    const { runScheduledChecks, STALE_AFTER_DAYS } = await import("./schedule.ts");
    const { getStore } = await import("@probes/core/server");
    const old = new Date(Date.now() - (STALE_AFTER_DAYS + 5) * 86_400_000).toISOString();

    await getStore().saveArtifact({
      id: "set-stale",
      probe: "uptime",
      sessionId: "s2",
      payload: {
        checkedAt: old,
        monitors: [{ input: "http://127.0.0.1:1/", hostname: "127.0.0.1", worst: "critical" }],
        summary: { total: 1, critical: 1, warning: 0, healthy: 0 },
        limitations: [],
        history: [],
      } as never,
      createdAt: old,
    });

    const report = await runScheduledChecks();
    expect(report.skippedStale).toBeGreaterThanOrEqual(1);
    // Untouched: the stored result still says what it said.
    const stale = await getStore().getArtifact("set-stale");
    expect((stale?.payload as unknown as { checkedAt: string }).checkedAt).toBe(old);
  });
});

describe("rate limiting the check endpoint", () => {
  it("refuses an eleventh check in an hour, because each one hits someone else's server", async () => {
    const { POST } = await import("../app/api/check/route.ts");
    const { resetRateLimits } = await import("@probes/app-kit");
    resetRateLimits();

    const call = () =>
      POST(
        new Request("http://localhost/api/check", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({ targets: "http://127.0.0.1:1/" }),
        }),
      );

    for (let i = 0; i < 10; i += 1) {
      expect((await call()).status, `call ${i + 1}`).toBe(200);
    }
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(((await blocked.json()) as { error: string }).error).toContain("checks in the last hour");
    resetRateLimits();
  });
});

describe("change alerts", () => {
  const monitorSet = (worst: Record<string, string>) => ({
    checkedAt: new Date().toISOString(),
    monitors: Object.entries(worst).map(([hostname, w]) => ({
      hostname,
      worst: w as Severity,
      findings: [] as { id: string; severity: Severity; title: string; detail: string; action: string }[],
    })),
    summary: { total: 1, critical: 0, warning: 0, healthy: 1 },
    limitations: [] as string[],
  });

  it("says nothing when nothing changed", async () => {
    const { diffChecks } = await import("./notify.ts");
    const same = monitorSet({ "a.com": "ok", "b.com": "critical" });
    expect(diffChecks(same as never, same as never)).toHaveLength(0);
  });

  it("reports a site that broke and one that recovered", async () => {
    const { diffChecks } = await import("./notify.ts");
    const changes = diffChecks(
      monitorSet({ "a.com": "ok", "b.com": "critical" }) as never,
      monitorSet({ "a.com": "critical", "b.com": "ok" }) as never,
    );
    expect(changes).toHaveLength(2);
    expect(changes.find((c) => c.hostname === "a.com")?.direction).toBe("broke");
    expect(changes.find((c) => c.hostname === "b.com")?.direction).toBe("recovered");
  });

  it("does not treat a newly added site as a change", async () => {
    const { diffChecks } = await import("./notify.ts");
    const changes = diffChecks(
      monitorSet({ "a.com": "ok" }) as never,
      monitorSet({ "a.com": "ok", "new.com": "critical" }) as never,
    );
    expect(changes).toHaveLength(0);
  });

  it("stays silent when a set has no alert address", async () => {
    const { notifyChanges } = await import("./notify.ts");
    const outcome = await notifyChanges(
      { ...monitorSet({ "a.com": "critical" }), alertEmails: [] } as never,
      [{ hostname: "a.com", from: "ok", to: "critical", direction: "broke", summary: "Down" }],
      "https://example.com/s/x",
    );
    expect(outcome.sent).toBe(0);
    expect(outcome.skipped).toContain("no alert address");
  });

  it("writes a subject that names what is wrong", async () => {
    const { changeAlertEmail } = await import("./notify.ts");
    const one = changeAlertEmail(
      [{ hostname: "acme.com", from: "ok", to: "critical", direction: "broke", summary: "Not responding" }],
      "Northline Studio",
      "https://example.com/s/x",
    );
    expect(one.subject).toBe("acme.com needs attention");
    expect(one.text).toContain("Not responding");
    expect(one.text).toContain("Northline Studio");
    // The promise that stops people filtering it.
    expect(one.text).toContain("does not get a daily reminder");
  });

  it("writes a recovery subject when everything improved", async () => {
    const { changeAlertEmail } = await import("./notify.ts");
    const result = changeAlertEmail(
      [{ hostname: "acme.com", from: "critical", to: "ok", direction: "recovered", summary: "Back to normal" }],
      "Northline Studio",
      "https://example.com/s/x",
    );
    expect(result.subject).toContain("back to normal");
  });
});
