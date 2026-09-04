import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formRequest, jsonRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as ledgerRoute } from "../app/api/ledger/route.ts";
import { GET as exportGet, POST as exportPost } from "../app/api/export/route.ts";
import { buildLedger } from "./ledger.ts";
import { applyOverrides, merchantKey, parseOverrides } from "./overrides.ts";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", name), "utf8");
const rows = () =>
  fixture("statement-hdfc.csv")
    .split("\n")
    .map((line) => line.split(","));

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

describe("merchantKey", () => {
  it("finds the merchant in a bank narration", () => {
    expect(merchantKey("UPI-SWIGGY-swiggy@ybl-PAYTM-409123456")).toBe("swiggy");
    expect(merchantKey("UPI-AWS AMAZON WEB SERVICES-aws@icici")).toBe("aws");
    expect(merchantKey("GOOGLE ADS INDIA PVT LTD")).toBe("google");
    expect(merchantKey("UPI-NETFLIX ENTERTAINMENT SERVICES")).toBe("netflix");
  });

  it("takes the first meaningful token, not the longest", () => {
    // Longest-wins produced "services" for AWS and "koramangala" for an ATM
    // withdrawal — both would group unrelated rows under one rule.
    expect(merchantKey("ATM CASH WDL BLR KORAMANGALA")).toBe("cash");
    expect(merchantKey("UPI-AWS AMAZON WEB SERVICES-aws@icici")).not.toBe("services");
  });

  it("skips rail noise", () => {
    for (const noise of ["upi", "neft", "imps", "pos", "atm", "ref", "txn"]) {
      expect(merchantKey(`${noise} realmerchant`)).toBe("realmerchant");
    }
  });

  it("returns null when there is no word to key on", () => {
    expect(merchantKey("1234567890")).toBeNull();
    expect(merchantKey("")).toBeNull();
    expect(merchantKey("UPI NEFT REF")).toBeNull();
  });

  it("is stable across the reference numbers that differ per transaction", () => {
    expect(merchantKey("UPI-SWIGGY-swiggy@ybl-111111")).toBe(
      merchantKey("UPI-SWIGGY-swiggy@ybl-999999"),
    );
  });
});

describe("applyOverrides", () => {
  const base = () => buildLedger(rows());

  it("changes every row for that merchant, not just the one corrected", () => {
    const before = base();
    const swiggyRows = before.entries.filter((e) => e.narration.includes("SWIGGY"));
    expect(swiggyRows.length).toBeGreaterThan(0);
    expect(swiggyRows.every((e) => e.category === "food-delivery")).toBe(true);

    const after = applyOverrides(before, { swiggy: "professional-fees" });
    const corrected = after.entries.filter((e) => e.narration.includes("SWIGGY"));
    expect(corrected.every((e) => e.category === "professional-fees")).toBe(true);
    expect(corrected[0]?.matchedOn).toBe("your rule: swiggy");
  });

  it("moves the totals, not just the labels", () => {
    const before = base();
    const after = applyOverrides(before, { swiggy: "professional-fees" });

    const foodBefore = before.byCategory.find((c) => c.category === "food-delivery")?.total ?? 0;
    const foodAfter = after.byCategory.find((c) => c.category === "food-delivery")?.total ?? 0;
    expect(foodAfter).toBeLessThan(foodBefore);

    // A correction that left the category breakdown alone would be cosmetic.
    const feesAfter = after.byCategory.find((c) => c.category === "professional-fees")?.total ?? 0;
    expect(feesAfter).toBeGreaterThan(0);
  });

  it("recomputes the GST shortlist", () => {
    const before = base();
    // Rent does not commonly carry GST; software does.
    const after = applyOverrides(before, { rent: "software-saas" });
    expect(after.gst.reviewableSpend).toBeGreaterThan(before.gst.reviewableSpend);
    expect(after.gst.reviewableCount).toBeGreaterThan(before.gst.reviewableCount);
  });

  it("recomputes the uncategorised count when a rule resolves one", () => {
    const before = base();
    expect(before.uncategorisedCount).toBeGreaterThan(0);
    const unknown = before.entries.find((e) => e.category === "uncategorised");
    const key = merchantKey(unknown?.narration ?? "");
    expect(key).toBeTruthy();

    const after = applyOverrides(before, { [key as string]: "client-payment" });
    expect(after.uncategorisedCount).toBeLessThan(before.uncategorisedCount);
  });

  it("leaves the ledger untouched when there are no rules", () => {
    const before = base();
    expect(applyOverrides(before, {})).toBe(before);
  });

  it("says in the assumptions that the user's rules were applied", () => {
    const after = applyOverrides(base(), { swiggy: "groceries" });
    expect(after.assumptions.join(" ")).toContain("your own category rules");
  });

  it("never changes the money totals, only where the money is filed", () => {
    const before = base();
    const after = applyOverrides(before, { swiggy: "groceries", rent: "software-saas" });
    expect(after.totals).toEqual(before.totals);
    expect(after.entries).toHaveLength(before.entries.length);
  });
});

describe("parseOverrides", () => {
  it("keeps valid pairs and drops everything else", () => {
    expect(
      parseOverrides({
        swiggy: "food-delivery",
        bogus: "not-a-category",
        "": "rent",
        nested: { a: 1 },
        [`${"x".repeat(80)}`]: "rent",
      }),
    ).toEqual({ swiggy: "food-delivery" });
  });

  it("rejects non-objects rather than throwing", () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides("swiggy")).toEqual({});
    expect(parseOverrides(["swiggy"])).toEqual({});
  });
});

describe("POST /api/export", () => {
  async function buildAndGetId(): Promise<string> {
    const response = await ledgerRoute(
      formRequest("http://localhost/api/ledger", { text: fixture("statement-hdfc.csv") }),
    );
    return ((await response.json()) as { id: string }).id;
  }

  it("produces a workbook that reflects the caller's corrections", async () => {
    const id = await buildAndGetId();

    const plain = await exportGet(new Request(`http://localhost/api/export?id=${id}`));
    const corrected = await exportPost(
      jsonRequest("http://localhost/api/export", {
        id,
        overrides: { swiggy: "professional-fees", zomato: "professional-fees" },
      }),
    );

    expect(plain.status).toBe(200);
    expect(corrected.status).toBe(200);

    const plainBytes = new Uint8Array(await plain.arrayBuffer());
    const correctedBytes = new Uint8Array(await corrected.arrayBuffer());
    expect([...correctedBytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // The spreadsheet must differ, or the corrections were silently dropped.
    expect(correctedBytes.byteLength).not.toBe(plainBytes.byteLength);
  });

  it("ignores rubbish in the overrides rather than failing the download", async () => {
    const id = await buildAndGetId();
    const response = await exportPost(
      jsonRequest("http://localhost/api/export", { id, overrides: "nonsense" }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects a request with no id", async () => {
    const response = await exportPost(jsonRequest("http://localhost/api/export", {}));
    expect(response.status).toBe(400);
  });

  it("404s an unknown id", async () => {
    const response = await exportPost(
      jsonRequest("http://localhost/api/export", { id: "nope", overrides: {} }),
    );
    expect(response.status).toBe(404);
  });
});
