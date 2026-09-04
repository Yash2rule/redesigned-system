import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStore } from "./file-store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "filestore-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const session = (id: string, probe: "ledger" | "uptime" = "ledger") => ({
  id,
  probe,
  createdAt: new Date().toISOString(),
  userAgent: null,
  referrer: null,
});

describe("FileStore", () => {
  it("round-trips sessions, events and intents", async () => {
    const store = new FileStore(dir);
    await store.ensureSession(session("s1"));
    await store.recordEvent({
      id: "e1",
      sessionId: "s1",
      probe: "ledger",
      name: "page_view",
      props: {},
      createdAt: new Date().toISOString(),
    });

    const funnel = await store.funnel();
    const ledger = funnel.find((f) => f.probe === "ledger");
    expect(ledger?.sessions).toBe(1);
    expect(ledger?.counts.page_view).toBe(1);
  });

  it("counts distinct visitors per event, not raw events", async () => {
    const store = new FileStore(dir);
    await store.ensureSession(session("s1"));
    for (let i = 0; i < 5; i += 1) {
      await store.recordEvent({
        id: `e${i}`,
        sessionId: "s1",
        probe: "ledger",
        name: "page_view",
        props: {},
        createdAt: new Date().toISOString(),
      });
    }
    const ledger = (await store.funnel()).find((f) => f.probe === "ledger");
    // Five page views by one person is one person.
    expect(ledger?.counts.page_view).toBe(1);
  });

  it("is idempotent on ensureSession", async () => {
    const store = new FileStore(dir);
    await store.ensureSession(session("s1"));
    await store.ensureSession(session("s1"));
    expect((await store.funnel()).find((f) => f.probe === "ledger")?.sessions).toBe(1);
  });

  it("sees writes made by another instance on the same directory", async () => {
    // Next bundles route handlers and pages separately, so the store singleton
    // genuinely exists more than once in one server process. A decision
    // written through an API route must be visible to the page that renders
    // the dashboard.
    const writer = new FileStore(dir);
    const reader = new FileStore(dir);

    // Reader warms its cache first, before anything has been written.
    expect((await reader.getProbeStates()).every((s) => s.decision === "undecided")).toBe(true);

    await writer.setProbeDecision("ledger", "kill", "lowest intent rate");
    await writer.ensureSession(session("s9"));

    const states = await reader.getProbeStates();
    expect(states.find((s) => s.probe === "ledger")?.decision).toBe("kill");
    expect(states.find((s) => s.probe === "ledger")?.note).toBe("lowest intent rate");
    expect((await reader.funnel()).find((f) => f.probe === "ledger")?.sessions).toBe(1);
  });

  it("survives a torn final line in a JSONL file", async () => {
    const store = new FileStore(dir);
    await store.ensureSession(session("s1"));

    const { appendFileSync } = await import("node:fs");
    appendFileSync(path.join(dir, "sessions.jsonl"), '{"id":"broken",');

    const fresh = new FileStore(dir);
    expect((await fresh.funnel()).find((f) => f.probe === "ledger")?.sessions).toBe(1);
  });

  it("returns defaults for probes with no decision recorded", async () => {
    const states = await new FileStore(dir).getProbeStates();
    expect(states).toHaveLength(4);
    expect(states.every((s) => s.decision === "undecided")).toBe(true);
  });

  it("stores and retrieves artifacts", async () => {
    const store = new FileStore(dir);
    await store.saveArtifact({
      id: "a1",
      probe: "uptime",
      sessionId: "s1",
      payload: { hello: "world" },
      createdAt: new Date().toISOString(),
    });
    expect((await store.getArtifact("a1"))?.payload).toEqual({ hello: "world" });
    expect(await store.getArtifact("missing")).toBeNull();
  });

  it("keeps working when the directory cannot be written", async () => {
    // A read-only or ephemeral filesystem must degrade, never throw: losing a
    // funnel event is bad, 500ing a visitor's result is worse.
    const store = new FileStore("/proc/definitely-not-writable/probe-data");
    await expect(store.ensureSession(session("s1"))).resolves.toBeUndefined();
    await expect(
      store.recordEvent({
        id: "e1",
        sessionId: "s1",
        probe: "ledger",
        name: "page_view",
        props: {},
        createdAt: new Date().toISOString(),
      }),
    ).resolves.toBeUndefined();

    // And it still reports its own writes back for the life of the process.
    const ledger = (await store.funnel()).find((f) => f.probe === "ledger");
    expect(ledger?.sessions).toBe(1);
    expect(ledger?.counts.page_view).toBe(1);
  });
});
