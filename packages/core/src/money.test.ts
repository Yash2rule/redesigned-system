import { describe, expect, it } from "vitest";
import { formatInr, formatIndianShort, formatMoney, formatUsd, parseIndianAmount } from "./money.ts";

describe("formatInr", () => {
  it("groups digits the Indian way", () => {
    expect(formatInr(100_00)).toBe("₹100");
    expect(formatInr(1_000_00)).toBe("₹1,000");
    expect(formatInr(1_00_000_00)).toBe("₹1,00,000");
    expect(formatInr(24_00_000_00)).toBe("₹24,00,000");
    expect(formatInr(1_23_45_678_00)).toBe("₹1,23,45,678");
  });

  it("handles zero and negatives", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(-1_00_000_00)).toBe("-₹1,00,000");
  });

  it("shows paise when asked", () => {
    expect(formatInr(1_234_56, { paise: true })).toBe("₹1,234.56");
    expect(formatInr(100_05, { paise: true })).toBe("₹100.05");
  });
});

describe("formatIndianShort", () => {
  it("uses lakh and crore, as people actually speak", () => {
    expect(formatIndianShort(24_00_000_00)).toBe("₹24 L");
    expect(formatIndianShort(12_50_000_00)).toBe("₹12.5 L");
    expect(formatIndianShort(1_20_00_000_00)).toBe("₹1.2 Cr");
    expect(formatIndianShort(45_000_00)).toBe("₹45k");
    expect(formatIndianShort(500_00)).toBe("₹500");
  });
});

describe("parseIndianAmount", () => {
  it("reads every way a salary gets written", () => {
    expect(parseIndianAmount("1200000")).toBe(12_00_000_00);
    expect(parseIndianAmount("12,00,000")).toBe(12_00_000_00);
    expect(parseIndianAmount("₹12,00,000")).toBe(12_00_000_00);
    expect(parseIndianAmount("12L")).toBe(12_00_000_00);
    expect(parseIndianAmount("12 lakh")).toBe(12_00_000_00);
    expect(parseIndianAmount("12 LPA")).toBe(12_00_000_00);
    expect(parseIndianAmount("1.2 Cr")).toBe(1_20_00_000_00);
    expect(parseIndianAmount("45k")).toBe(45_000_00);
  });

  it("prefers the longest unit, so LPA is not read as L", () => {
    // "32 LPA" must be thirty-two lakh, not thirty-two rupees.
    expect(parseIndianAmount("32 LPA")).toBe(32_00_000_00);
  });

  it("returns null when there is no number", () => {
    expect(parseIndianAmount("")).toBeNull();
    expect(parseIndianAmount("negotiable")).toBeNull();
    expect(parseIndianAmount("₹")).toBeNull();
  });

  it("round-trips against formatInr", () => {
    for (const minor of [0, 100_00, 45_678_00, 12_00_000_00, 1_23_45_678_00]) {
      expect(parseIndianAmount(formatInr(minor))).toBe(minor);
    }
  });
});

describe("formatMoney", () => {
  it("switches symbol and grouping by currency", () => {
    expect(formatMoney(7_900, "USD")).toBe("$79.00");
    expect(formatUsd(2_900)).toBe("$29.00");
    expect(formatMoney(49_900, "INR")).toBe("₹499");
  });
});

describe("formatIndianShort trailing zeros", () => {
  it("trims them without eating real zeros", () => {
    expect(formatIndianShort(12_50_000_00)).toBe("₹12.5 L");
    expect(formatIndianShort(12_00_000_00)).toBe("₹12 L");
    expect(formatIndianShort(1_20_00_000_00)).toBe("₹1.2 Cr");
    expect(formatIndianShort(1_00_00_000_00)).toBe("₹1 Cr");
    expect(formatIndianShort(1_20_000_00)).toBe("₹1.2 L");
    expect(formatIndianShort(10_000_00)).toBe("₹10k");
    // Not a decimal at all: the trailing zero must survive.
    expect(formatIndianShort(1_20_00_000_00 * 10)).toBe("₹12 Cr");
  });
});
