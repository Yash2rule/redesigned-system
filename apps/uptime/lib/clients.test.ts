import { describe, expect, it } from "vitest";
import { parseTargetGroups, parseTargets } from "./monitor.ts";
import type { MonitorResult, Severity } from "./monitor.ts";
import { clientAssignments, hasClients, summariseByClient } from "./clients.ts";
import { buildStatusReport, forClient } from "./report.ts";
import { normaliseLogoUrl } from "./brand.ts";

const monitor = (hostname: string, worst: Severity): MonitorResult =>
  ({
    input: hostname,
    hostname,
    url: `https://${hostname}/`,
    checkedAt: new Date().toISOString(),
    http: { ok: true, status: 200, latencyMs: 10, finalUrl: null, redirects: [], downgradedToHttp: false, error: null, headers: {} },
    tls: null,
    domain: { ok: true, registrar: null, expiresAt: null, daysRemaining: null, statuses: [], source: "unavailable", error: null },
    findings:
      worst === "ok"
        ? []
        : [{ id: `f-${hostname}`, severity: worst, title: `${hostname} problem`, detail: "d", action: "a" }],
    worst,
  }) as unknown as MonitorResult;

describe("parseTargetGroups", () => {
  it("assigns the domains under a # heading to that client", () => {
    const groups = parseTargetGroups(`# Acme Ltd
acme.com
shop.acme.com

# Borden & Co
borden.in`);
    expect(groups).toEqual([
      { client: "Acme Ltd", targets: ["acme.com", "shop.acme.com"] },
      { client: "Borden & Co", targets: ["borden.in"] },
    ]);
  });

  it("leaves a plain list with no client at all", () => {
    expect(parseTargetGroups("acme.com\nborden.in")).toEqual([
      { client: null, targets: ["acme.com", "borden.in"] },
    ]);
  });

  it("keeps domains typed above the first heading unassigned", () => {
    const groups = parseTargetGroups("loose.com\n# Acme\nacme.com");
    expect(groups[0]).toEqual({ client: null, targets: ["loose.com"] });
    expect(groups[1]).toEqual({ client: "Acme", targets: ["acme.com"] });
  });

  it("still accepts commas within a client's line", () => {
    expect(parseTargetGroups("# Acme\nacme.com, shop.acme.com")).toEqual([
      { client: "Acme", targets: ["acme.com", "shop.acme.com"] },
    ]);
  });

  it("gives a repeated domain to whichever client claimed it first", () => {
    const groups = parseTargetGroups("# Acme\nshared.com\n# Borden\nshared.com\nborden.in");
    expect(groups).toEqual([
      { client: "Acme", targets: ["shared.com"] },
      { client: "Borden", targets: ["borden.in"] },
    ]);
  });

  it("drops an empty heading rather than inventing a client called nothing", () => {
    expect(parseTargetGroups("#\nacme.com")).toEqual([{ client: null, targets: ["acme.com"] }]);
  });

  it("parses the same domains parseTargets always did", () => {
    // The # line used to be discarded as a comment. Nothing that worked
    // before may parse differently now.
    expect(parseTargets("# a comment\nacme.com\nborden.in")).toEqual(["acme.com", "borden.in"]);
  });
});

describe("summariseByClient", () => {
  const assignments = clientAssignments(
    parseTargetGroups("# Acme\nacme.com\nshop.acme.com\n# Borden\nborden.in\n"),
  );

  it("knows whether any client was named", () => {
    expect(hasClients(assignments)).toBe(true);
    expect(hasClients({})).toBe(false);
  });

  it("counts each client separately rather than as one total", () => {
    const summaries = summariseByClient(
      [monitor("acme.com", "critical"), monitor("shop.acme.com", "ok"), monitor("borden.in", "ok")],
      assignments,
    );
    const acme = summaries.find((s) => s.client === "Acme");
    expect(acme?.counts).toEqual({ total: 2, critical: 1, warning: 0, healthy: 1 });
    expect(summaries.find((s) => s.client === "Borden")?.counts.critical).toBe(0);
  });

  it("puts the client you need to phone first", () => {
    const summaries = summariseByClient(
      [monitor("borden.in", "ok"), monitor("acme.com", "critical"), monitor("shop.acme.com", "ok")],
      assignments,
    );
    expect(summaries.map((s) => s.client)).toEqual(["Acme", "Borden"]);
  });

  it("puts unassigned domains last — they are the agency's own", () => {
    const summaries = summariseByClient(
      [monitor("ours.com", "critical"), monitor("borden.in", "ok")],
      assignments,
    );
    expect(summaries.at(-1)?.client).toBeNull();
  });

  it("returns one unnamed group when nobody named a client", () => {
    const summaries = summariseByClient([monitor("acme.com", "ok")], {});
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.client).toBeNull();
  });
});

describe("forClient", () => {
  const result = {
    monitors: [monitor("acme.com", "critical"), monitor("borden.in", "ok")],
    checkedAt: new Date().toISOString(),
    summary: { total: 2, critical: 1, warning: 0, healthy: 1 },
    limitations: [],
    clients: { "acme.com": "Acme", "borden.in": "Borden" },
  };

  it("narrows to one client's sites so the PDF can be forwarded", () => {
    const scoped = forClient(result, "Acme");
    expect(scoped.monitors.map((m) => m.hostname)).toEqual(["acme.com"]);
    // The totals are that client's, not the agency's.
    expect(scoped.summary).toEqual({ total: 1, critical: 1, warning: 0, healthy: 0 });
  });

  it("does not leak another client's domains into the narrowed report", () => {
    expect(JSON.stringify(forClient(result, "Acme"))).not.toContain("borden.in");
  });

  it("matches the client name case-insensitively", () => {
    expect(forClient(result, "  acme  ").monitors).toHaveLength(1);
  });

  it("refuses a client that is not in this check", () => {
    expect(() => forClient(result, "Someone Else")).toThrow(/No client called/);
  });
});

describe("normaliseLogoUrl", () => {
  it("accepts an https image URL", () => {
    expect(normaliseLogoUrl("https://acme.com/logo.svg")).toBe("https://acme.com/logo.svg");
    expect(normaliseLogoUrl("  https://acme.com/logo.png  ")).toBe("https://acme.com/logo.png");
  });

  it("refuses anything that is not https", () => {
    // This string ends up in a src attribute on a page other people open.
    for (const raw of [
      "javascript:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "http://acme.com/logo.png",
      "//acme.com/logo.png",
      "logo.png",
      "",
      "   ",
    ]) {
      expect(normaliseLogoUrl(raw), raw).toBeUndefined();
    }
  });

  it("refuses a non-string and an over-long URL", () => {
    expect(normaliseLogoUrl(undefined)).toBeUndefined();
    expect(normaliseLogoUrl(42)).toBeUndefined();
    expect(normaliseLogoUrl(`https://acme.com/${"a".repeat(400)}.png`)).toBeUndefined();
  });
});

describe("buildStatusReport scoped to a client", () => {
  const result = {
    monitors: [monitor("acme.com", "critical"), monitor("shop.acme.com", "ok"), monitor("borden.in", "ok")],
    checkedAt: new Date().toISOString(),
    summary: { total: 3, critical: 1, warning: 0, healthy: 2 },
    limitations: ["Checked once, not continuously."],
    clients: { "acme.com": "Acme", "shop.acme.com": "Acme", "borden.in": "Borden" },
    brand: { name: "Northline", color: "#0f766e" },
  };

  it("renders a real PDF for one client, smaller than the whole portfolio", async () => {
    const [all, acme, borden] = await Promise.all([
      buildStatusReport(result),
      buildStatusReport(result, "Acme"),
      buildStatusReport(result, "Borden"),
    ]);
    for (const pdf of [all, acme, borden]) {
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    }
    // Three sites documented beats two beats one.
    expect(all.length).toBeGreaterThan(acme.length);
    expect(acme.length).toBeGreaterThan(borden.length);
  });

  it("refuses to render a client that is not in the check", async () => {
    await expect(buildStatusReport(result, "Nobody")).rejects.toThrow(/No client called/);
  });
});
