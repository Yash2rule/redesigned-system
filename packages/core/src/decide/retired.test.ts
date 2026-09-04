import { afterEach, describe, expect, it } from "vitest";
import { RETIRED_MESSAGE, clearRetiredCache, isRetired } from "./retired.ts";
import { setStore } from "../store/index.ts";
import type { Store } from "../store/index.ts";

/**
 * The behaviour under test is mostly about what happens when things go wrong,
 * because that is where the cost is asymmetric: serving a retired probe for
 * one more minute loses a few rows nobody reads, while wrongly showing "this
 * experiment has ended" across four working products is a self-inflicted
 * outage that also lies to everyone who sees it.
 */

const stub = (states: unknown, onCall?: () => void): Store =>
  ({
    kind: "file",
    async getProbeStates() {
      onCall?.();
      if (states instanceof Error) throw states;
      return states as never;
    },
  }) as unknown as Store;

afterEach(() => {
  clearRetiredCache();
});

describe("isRetired", () => {
  it("reports a killed probe as retired", async () => {
    setStore(stub([{ probe: "ledger", decision: "kill", note: null, updatedAt: "" }]));
    expect(await isRetired("ledger")).toBe(true);
  });

  it("treats keep and undecided as live", async () => {
    setStore(
      stub([
        { probe: "ledger", decision: "keep", note: null, updatedAt: "" },
        { probe: "uptime", decision: "undecided", note: null, updatedAt: "" },
      ]),
    );
    expect(await isRetired("ledger")).toBe(false);
    expect(await isRetired("uptime")).toBe(false);
  });

  it("treats a probe with no row at all as live", async () => {
    setStore(stub([]));
    expect(await isRetired("offer-decoder")).toBe(false);
  });

  // The important one.
  it("fails open when the store throws", async () => {
    setStore(stub(new Error("pooler said no")));
    expect(await isRetired("ledger")).toBe(false);
  });

  it("does not cache a failure, so the next request tries again", async () => {
    let calls = 0;
    setStore(stub(new Error("down"), () => (calls += 1)));
    await isRetired("ledger");
    await isRetired("ledger");
    expect(calls).toBe(2);
  });

  it("keeps serving the last known answer when the store starts failing", async () => {
    let fail = false;
    const store = {
      kind: "file",
      async getProbeStates() {
        if (fail) throw new Error("down");
        return [{ probe: "ledger", decision: "kill", note: null, updatedAt: "" }] as never;
      },
    } as unknown as Store;
    setStore(store);

    expect(await isRetired("ledger")).toBe(true);
    fail = true;
    clearRetiredCache();
    // Cache cleared and the store now failing: falls open rather than
    // remembering a verdict it can no longer confirm.
    expect(await isRetired("ledger")).toBe(false);
  });

  it("caches a success rather than querying per page view", async () => {
    let calls = 0;
    setStore(stub([{ probe: "ledger", decision: "kill", note: null, updatedAt: "" }], () => (calls += 1)));
    await isRetired("ledger");
    await isRetired("ledger");
    await isRetired("ledger");
    expect(calls).toBe(1);
  });

  it("re-reads after the cache is cleared, so a fresh verdict lands at once", async () => {
    let calls = 0;
    setStore(stub([{ probe: "ledger", decision: "kill", note: null, updatedAt: "" }], () => (calls += 1)));
    await isRetired("ledger");
    clearRetiredCache();
    await isRetired("ledger");
    expect(calls).toBe(2);
  });
});

describe("RETIRED_MESSAGE", () => {
  it("says what happened without asking the reader for anything", async () => {
    expect(RETIRED_MESSAGE).toContain("ended");
    expect(RETIRED_MESSAGE.toLowerCase()).not.toContain("email");
    expect(RETIRED_MESSAGE.toLowerCase()).not.toContain("sign up");
  });
});
