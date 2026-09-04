import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatIndianShort, formatInr } from "@probes/core";
import { formRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as decode } from "../app/api/decode/route.ts";
import { buildComparison, parseIds } from "./compare.ts";
import { MAX_COMPARE } from "./saved.ts";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", name), "utf8");

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

async function decodeFixture(name: string, fields: Record<string, string> = {}): Promise<string> {
  const response = await decode(
    formRequest("http://localhost/api/decode", { state: "KA", ...fields, text: fixture(name) }),
  );
  const { id } = (await response.json()) as { id: string };
  return id;
}

describe("parseIds", () => {
  it("accepts UUIDs and ignores anything else", () => {
    const good = "8997ff7d-1111-2222-3333-444444444444";
    expect(parseIds(`${good},not-a-uuid, ,<script>`)).toEqual([good]);
  });

  it("de-duplicates and caps the list", () => {
    const ids = Array.from(
      { length: 9 },
      (_, i) => `0000000${i}-1111-2222-3333-444444444444`,
    ).join(",");
    expect(parseIds(ids)).toHaveLength(MAX_COMPARE);
  });

  it("handles an empty or absent parameter", () => {
    expect(parseIds(null)).toEqual([]);
    expect(parseIds("")).toEqual([]);
  });
});

describe("buildComparison", () => {
  it("puts two real offers side by side and marks the winner per row", async () => {
    const bigger = await decodeFixture("offer-letter-1.txt"); // ₹24L
    const smaller = await decodeFixture("offer-letter-2.txt"); // ₹18L

    const comparison = await buildComparison([bigger, smaller], formatInr, formatIndianShort);

    expect(comparison.offers).toHaveLength(2);
    expect(comparison.missingIds).toHaveLength(0);
    expect(comparison.rows.length).toBeGreaterThan(5);

    const inHand = comparison.rows.find((r) => r.label === "Monthly in-hand");
    expect(inHand?.bestIndex).toBe(0); // the ₹24L offer pays more in hand
    expect(inHand?.values).toHaveLength(2);

    const tax = comparison.rows.find((r) => r.label.startsWith("Income tax"));
    // Lower tax is "best" on that row — which is the smaller offer.
    expect(tax?.bestIndex).toBe(1);
  });

  it("quantifies the gap in the verdict, per month and per year", async () => {
    const a = await decodeFixture("offer-letter-1.txt");
    const b = await decodeFixture("offer-letter-2.txt");
    const { verdict } = await buildComparison([a, b], formatInr, formatIndianShort);

    expect(verdict[0]).toContain("Offer 1 pays the most in hand");
    expect(verdict[0]).toContain("a month more");
    expect(verdict[0]).toContain("over a year");
  });

  it("always ends by saying what the numbers cannot tell you", async () => {
    const a = await decodeFixture("offer-letter-1.txt");
    const b = await decodeFixture("offer-letter-2.txt");
    const { verdict } = await buildComparison([a, b], formatInr, formatIndianShort);
    expect(verdict[verdict.length - 1]).toContain("cannot see");
  });

  it("warns when the winner only wins if its variable pays out", async () => {
    // Offer 1 has ₹2.4L of variable; offer 2 has ₹1.8L. Assume neither pays.
    const a = await decodeFixture("offer-letter-1.txt", { downsidePayoutRatio: "0" });
    const b = await decodeFixture("offer-letter-2.txt", { downsidePayoutRatio: "0" });
    const { rows } = await buildComparison([a, b], formatInr, formatIndianShort);

    const downside = rows.find((r) => r.label.includes("variable underperforms"));
    expect(downside).toBeTruthy();
    expect(downside?.values).toHaveLength(2);
  });

  it("reports ids it could not find instead of silently dropping them", async () => {
    const real = await decodeFixture("offer-letter-1.txt");
    const missing = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const comparison = await buildComparison([real, missing], formatInr, formatIndianShort);

    expect(comparison.offers).toHaveLength(1);
    expect(comparison.missingIds).toEqual([missing]);
  });

  it("returns nothing rather than throwing when no id resolves", async () => {
    const comparison = await buildComparison(
      ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"],
      formatInr,
      formatIndianShort,
    );
    expect(comparison.offers).toHaveLength(0);
    expect(comparison.rows).toHaveLength(0);
    expect(comparison.verdict).toHaveLength(0);
  });

  it("does not crown a winner when the offers tie", async () => {
    const a = await decodeFixture("offer-letter-1.txt");
    const b = await decodeFixture("offer-letter-1.txt");
    const { rows, verdict } = await buildComparison([a, b], formatInr, formatIndianShort);

    expect(rows.find((r) => r.label === "Monthly in-hand")?.bestIndex).toBeNull();
    expect(verdict[0]).toContain("pay the same");
  });
});
