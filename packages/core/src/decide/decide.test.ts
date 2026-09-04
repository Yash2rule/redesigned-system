import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, ranksOnPayment, recommend, recommendAll } from "./index.ts";
import type { FunnelCounts } from "./index.ts";

const counts = (over: Partial<FunnelCounts> = {}): FunnelCounts => ({
  landed: 500,
  results: 200,
  pricesClicked: 60,
  emails: 20,
  paid: 0,
  ...over,
});

describe("recommend — the sample floor", () => {
  // The single most important behaviour here. Everything else is arithmetic;
  // this is the part that stops the automation from being worse than nothing.
  it("refuses to decide anything below the traffic floor", () => {
    const r = recommend("ledger", counts({ landed: 99, results: 200 }), false);
    expect(r.verdict).toBe("insufficient-data");
    expect(r.metric).toBe("none");
    expect(r.metricPct).toBeNull();
  });

  it("refuses on too few results even with plenty of landers", () => {
    const r = recommend("ledger", counts({ landed: 100_000, results: 19 }), false);
    expect(r.verdict).toBe("insufficient-data");
  });

  it("refuses on an empty funnel rather than dividing by zero", () => {
    const r = recommend("uptime", counts({ landed: 0, results: 0, emails: 0 }), false);
    expect(r.verdict).toBe("insufficient-data");
    expect(r.needs).toEqual({ landed: 100, results: 20 });
  });

  it("says how much more traffic it needs", () => {
    const r = recommend("ledger", counts({ landed: 40, results: 5 }), false);
    expect(r.needs).toEqual({ landed: 60, results: 15 });
  });

  it("never kills on a tiny sample, however bad the rate looks", () => {
    // 0 of 19 is 0%, which would trip every kill rule if the floor were absent.
    const r = recommend("ledger", counts({ landed: 99, results: 19, emails: 0 }), false);
    expect(r.verdict).not.toBe("kill");
  });

  it("decides exactly at the floor, not one visitor later", () => {
    const r = recommend("ledger", counts({ landed: 100, results: 20, emails: 0 }), false);
    expect(r.verdict).toBe("kill");
  });
});

describe("recommend — the activation guard", () => {
  it("reports a broken funnel rather than absent demand", () => {
    // 20 results from 500 landers is 4%: people are being lost upstream, and
    // what the survivors did says nothing about whether anyone wants this.
    const r = recommend("offer-decoder", counts({ landed: 500, results: 20, emails: 0 }), false);
    expect(r.verdict).toBe("watch");
    expect(r.reason).toContain("upstream");
    expect(r.metric).toBe("none");
  });

  it("does not let a broken funnel kill a probe", () => {
    const r = recommend("offer-decoder", counts({ landed: 5000, results: 100, emails: 0 }), false);
    expect(r.verdict).not.toBe("kill");
  });
});

describe("recommend — the verdicts", () => {
  it("kills when people who saw it work did not want it", () => {
    const r = recommend("ledger", counts({ results: 200, emails: 2 }), false);
    expect(r.verdict).toBe("kill");
    expect(r.metricPct).toBe(1);
  });

  it("keeps when the intent rate clears the bar", () => {
    const r = recommend("ledger", counts({ results: 200, emails: 20 }), false);
    expect(r.verdict).toBe("keep");
    expect(r.metricPct).toBe(10);
  });

  it("watches the middle rather than forcing a call", () => {
    const r = recommend("ledger", counts({ results: 200, emails: 10 }), false);
    expect(r.verdict).toBe("watch");
    expect(r.metricPct).toBe(5);
  });

  it("treats the boundaries as inclusive where it says it does", () => {
    expect(recommend("ledger", counts({ results: 200, emails: 16 }), false).verdict).toBe("keep");
    expect(recommend("ledger", counts({ results: 200, emails: 15 }), false).verdict).toBe("watch");
    expect(recommend("ledger", counts({ results: 200, emails: 4 }), false).verdict).toBe("watch");
    expect(recommend("ledger", counts({ results: 200, emails: 3 }), false).verdict).toBe("kill");
  });
});

describe("recommend — which metric it ranks on", () => {
  it("uses intent while no payment rail is live", () => {
    const r = recommend("ledger", counts({ results: 200, emails: 30, paid: 0 }), false);
    expect(r.metric).toBe("intent-rate");
    expect(r.verdict).toBe("keep");
  });

  // Without this switch, a live rail would still be judged on email capture,
  // and nobody remembers to change a comparator by hand.
  it("switches to payment the moment a rail is live", () => {
    const r = recommend("ledger", counts({ results: 200, emails: 30, paid: 0 }), true);
    expect(r.metric).toBe("paid-rate");
    expect(r.verdict).toBe("kill");
    expect(r.reason).toContain("paid");
  });

  it("keeps on real payments once the rail is live", () => {
    const r = recommend("ledger", counts({ results: 200, emails: 0, paid: 30 }), true);
    expect(r.metric).toBe("paid-rate");
    expect(r.verdict).toBe("keep");
  });
});

describe("recommendAll", () => {
  const all = (over: Partial<Record<string, Partial<FunnelCounts>>> = {}) =>
    ({
      "offer-decoder": counts({ results: 200, emails: 40, ...over["offer-decoder"] }),
      ledger: counts({ results: 200, emails: 20, ...over.ledger }),
      uptime: counts({ results: 200, emails: 2, ...over.uptime }),
      "freelancer-kit": counts({ landed: 10, results: 2, ...over["freelancer-kit"] }),
    }) as never;

  it("ranks the strongest first and the undecidable last", () => {
    const rows = recommendAll(all(), {} as never);
    expect(rows.map((r) => r.probe)).toEqual(["offer-decoder", "ledger", "uptime", "freelancer-kit"]);
    expect(rows[0]?.verdict).toBe("keep");
    expect(rows[3]?.verdict).toBe("insufficient-data");
  });

  it("covers every probe exactly once", () => {
    const rows = recommendAll(all(), {} as never);
    expect(new Set(rows.map((r) => r.probe)).size).toBe(4);
  });
});

describe("thresholds", () => {
  it("are the documented defaults", () => {
    // Pinned deliberately: these numbers decide whether a product is switched
    // off, and changing one should be a visible edit with a failing test, not
    // a quiet tweak.
    expect(DEFAULT_THRESHOLDS).toEqual({
      minLanded: 100,
      minResults: 20,
      killBelowPct: 2,
      keepAbovePct: 8,
      minActivationPct: 10,
    });
  });

  it("honours overridden thresholds", () => {
    const r = recommend("ledger", counts({ landed: 10, results: 5, emails: 0 }), false, {
      ...DEFAULT_THRESHOLDS,
      minLanded: 10,
      minResults: 5,
    });
    expect(r.verdict).toBe("kill");
  });
});

describe("ranksOnPayment", () => {
  // Guards the same mistake as the sample floor, arriving through a different
  // door: one sale is not a payment rate.
  it("does not switch metric on a single sale", () => {
    expect(ranksOnPayment(counts({ paid: 1 }))).toBe(false);
    expect(ranksOnPayment(counts({ paid: 4 }))).toBe(false);
  });

  it("switches once there are enough payments to divide by", () => {
    expect(ranksOnPayment(counts({ paid: 5 }))).toBe(true);
    expect(ranksOnPayment(counts({ paid: 50 }))).toBe(true);
  });

  it("stays on intent while no rail is live at all", () => {
    expect(ranksOnPayment(counts({ paid: 0 }))).toBe(false);
  });
});
