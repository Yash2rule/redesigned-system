import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkHttp, checkTls, parseRdap } from "./checks.ts";
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
