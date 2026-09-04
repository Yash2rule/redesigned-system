import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as decideRoute } from "../app/api/cron/decide/route.ts";
import { clearRetiredCache, getStore, isRetired } from "@probes/core/server";
import type { EventName, ProbeId } from "@probes/core/server";
import { useTempStore } from "../../../tests/helpers.ts";

/**
 * The decision layer driven through its actual route against a real store,
 * because the part worth testing is not the arithmetic — that is covered in
 * `packages/core/src/decide` — but whether it writes to the switch when it
 * should and, far more importantly, leaves it alone when it should not.
 */

const SECRET = "a-secret-long-enough-to-pass";
let store: ReturnType<typeof useTempStore>;

beforeEach(() => {
  store = useTempStore();
  process.env.CRON_SECRET = SECRET;
  clearRetiredCache();
});

afterEach(() => {
  store.cleanup();
  delete process.env.CRON_SECRET;
  clearRetiredCache();
});

const request = (query = "", secret: string | null = SECRET) =>
  new Request(`http://localhost/api/cron/decide${query}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

/** Give a probe `n` distinct sessions that each fired `name`. */
async function seed(probe: ProbeId, name: EventName, n: number, offset = 0): Promise<void> {
  const s = getStore();
  for (let i = 0; i < n; i += 1) {
    const sessionId = `${probe}-${name}-${offset + i}`;
    await s.ensureSession({
      id: sessionId,
      probe,
      createdAt: new Date().toISOString(),
      userAgent: null,
      referrer: null,
    });
    await s.recordEvent({
      id: `${sessionId}-e`,
      sessionId,
      probe,
      name,
      props: {},
      createdAt: new Date().toISOString(),
    });
  }
}

/**
 * A funnel where the same visitors progress, rather than disjoint sets — the
 * shape the real events have, and the one the activation guard reads.
 */
async function funnel(probe: ProbeId, landed: number, results: number, emails: number) {
  const s = getStore();
  for (let i = 0; i < landed; i += 1) {
    const sessionId = `${probe}-v${i}`;
    await s.ensureSession({
      id: sessionId,
      probe,
      createdAt: new Date().toISOString(),
      userAgent: null,
      referrer: null,
    });
    const names: EventName[] = ["page_view"];
    if (i < results) names.push("result_viewed");
    if (i < emails) names.push("email_captured");
    for (const name of names) {
      await s.recordEvent({
        id: `${sessionId}-${name}`,
        sessionId,
        probe,
        name,
        props: {},
        createdAt: new Date().toISOString(),
      });
    }
  }
}

type Report = {
  changed: number;
  probes: { probe: ProbeId; action: string; recommendation: { verdict: string } }[];
};

/** A Response body can only be read once, so every test reads it once. */
const body = async (response: Response) => (await response.json()) as Report;

const forProbe = (report: Report, probe: ProbeId) => report.probes.find((p) => p.probe === probe);

describe("the decide endpoint — authorisation", () => {
  it("refuses without the secret, because it can retire a probe", async () => {
    expect((await decideRoute(request("", null))).status).toBe(401);
    expect((await decideRoute(request("", "wrong"))).status).toBe(401);
  });

  it("refuses when no secret is configured at all", async () => {
    delete process.env.CRON_SECRET;
    expect((await decideRoute(request())).status).toBe(401);
  });
});

describe("the decide endpoint — the sample floor", () => {
  it("changes nothing on an empty database", async () => {
    const response = await decideRoute(request());
    const parsed = await body(response);
    expect(response.status).toBe(200);
    expect(parsed.changed).toBe(0);
    expect(parsed.probes.every((p) => p.recommendation.verdict === "insufficient-data")).toBe(true);
  });

  // The failure this whole design exists to avoid.
  it("does not retire a probe whose only data is a bad week", async () => {
    await funnel("ledger", 40, 12, 0);
    await decideRoute(request());
    expect(await isRetired("ledger")).toBe(false);
  });
});

describe("the decide endpoint — acting", () => {
  it("retires a probe that people saw work and did not want", async () => {
    await funnel("ledger", 200, 100, 0);
    const report = await body(await decideRoute(request()));

    expect(forProbe(report, "ledger")?.recommendation.verdict).toBe("kill");
    expect(forProbe(report, "ledger")?.action).toBe("applied");
    expect(await isRetired("ledger")).toBe(true);
  });

  it("records the reasoning, so the verdict can be argued with later", async () => {
    await funnel("ledger", 200, 100, 0);
    await decideRoute(request());

    const state = (await getStore().getProbeStates()).find((s) => s.probe === "ledger");
    expect(state?.decision).toBe("kill");
    expect(state?.note).toContain("[auto]");
    expect(state?.note).toContain("0% of the 100 people");
  });

  it("keeps a probe that cleared the bar, and leaves it live", async () => {
    await funnel("uptime", 200, 100, 20);
    const report = await body(await decideRoute(request()));
    expect(forProbe(report, "uptime")?.recommendation.verdict).toBe("keep");
    expect(await isRetired("uptime")).toBe(false);
  });

  it("does not write the same verdict twice", async () => {
    await funnel("ledger", 200, 100, 0);
    await decideRoute(request());
    const second = await body(await decideRoute(request()));
    expect(second.changed).toBe(0);
    expect(forProbe(second, "ledger")?.action).toBe("unchanged");
  });

  it("changes nothing when asked for a dry run", async () => {
    await funnel("ledger", 200, 100, 0);
    const report = await body(await decideRoute(request("?dryRun=1")));
    expect(forProbe(report, "ledger")?.action).toBe("dry run");
    expect(await isRetired("ledger")).toBe(false);
  });
});

describe("the decide endpoint — the human wins", () => {
  it("never overwrites a decision a person made", async () => {
    await funnel("ledger", 200, 100, 0);
    await getStore().setProbeDecision("ledger", "keep", "I have a customer waiting on this");

    const report = await body(await decideRoute(request()));
    expect(forProbe(report, "ledger")?.recommendation.verdict).toBe("kill");
    expect(forProbe(report, "ledger")?.action).toBe("left to the human who set it");

    const state = (await getStore().getProbeStates()).find((s) => s.probe === "ledger");
    expect(state?.decision).toBe("keep");
    expect(state?.note).toBe("I have a customer waiting on this");
    expect(await isRetired("ledger")).toBe(false);
  });

  it("revises its own earlier verdict when the numbers move", async () => {
    await funnel("ledger", 200, 100, 0);
    await decideRoute(request());
    expect(await isRetired("ledger")).toBe(true);

    // The same visitors come back and leave emails: the rate is now well over
    // the keep bar, and the automation may revise what it wrote itself.
    await seed("ledger", "email_captured", 30, 0);
    clearRetiredCache();
    const report = await body(await decideRoute(request()));

    expect(forProbe(report, "ledger")?.action).toBe("applied");
    expect(forProbe(report, "ledger")?.recommendation.verdict).toBe("keep");
    expect(await isRetired("ledger")).toBe(false);
  });
});

describe("the decide endpoint — a broken funnel is not a verdict", () => {
  it("blames the funnel rather than demand when nobody reaches a result", async () => {
    // 1000 landers, 30 results: activation is 3%, under the floor.
    await funnel("freelancer-kit", 1000, 30, 0);
    const report = await body(await decideRoute(request()));

    const row = forProbe(report, "freelancer-kit");
    expect(row?.recommendation.verdict).toBe("watch");
    expect(row?.action).toBe("unchanged");
    expect(await isRetired("freelancer-kit")).toBe(false);
  });
});
