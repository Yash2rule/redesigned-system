import { describe, expect, it } from "vitest";
import { computeIncomeTax, slabTax, NEW_REGIME_SLABS } from "./tax.ts";

const L = (lakhs: number) => Math.round(lakhs * 100_000 * 100);
const rupees = (minor: number) => minor / 100;

describe("new regime, FY 2025-26", () => {
  it("charges nothing at ₹12.75 lakh, the widely quoted zero-tax salary", () => {
    // ₹12,00,000 rebate limit + ₹75,000 standard deduction.
    expect(computeIncomeTax(L(12.75), "new").total).toBe(0);
  });

  it("matches the published figure for a ₹15 lakh salary", () => {
    const result = computeIncomeTax(L(15), "new");
    expect(rupees(result.taxableIncome)).toBe(14_25_000);
    expect(rupees(result.slabTax)).toBe(93_750);
    expect(rupees(result.cess)).toBe(3_750);
    expect(rupees(result.total)).toBe(97_500);
  });

  it("matches the published figure for a ₹24 lakh salary", () => {
    expect(rupees(computeIncomeTax(L(24), "new").total)).toBe(2_92_500);
  });

  it("applies 87A marginal relief just above the rebate limit", () => {
    // Taxable income ₹12,05,000: tax is capped at the ₹5,000 of income above
    // the limit, plus cess. Without relief this would be roughly ₹63,000.
    const result = computeIncomeTax(L(12.8), "new");
    expect(rupees(result.taxableIncome)).toBe(12_05_000);
    expect(rupees(result.total)).toBe(5_200);
    expect(result.notes.some((n) => n.includes("Marginal relief"))).toBe(true);
  });

  it("never makes extra income cost more than itself in tax, before cess", () => {
    // Marginal relief is computed on tax before cess, and the 4% cess is then
    // levied on the relieved figure. So the guarantee the statute actually
    // gives is on the pre-cess number, and `total` can exceed the extra income
    // by exactly that 4%.
    const preCess = (income: number) => {
      const r = computeIncomeTax(L(income), "new");
      return r.total - r.cess;
    };
    for (let income = 11.9; income <= 13.2; income += 0.05) {
      const extraIncome = L(income + 0.01) - L(income);
      expect(preCess(income + 0.01) - preCess(income)).toBeLessThanOrEqual(extraIncome);
    }
  });

  it("keeps the cess overhang on relieved tax within 4%", () => {
    const lower = computeIncomeTax(L(12.75), "new");
    const higher = computeIncomeTax(L(12.76), "new");
    const extraIncome = L(12.76) - L(12.75);
    expect(higher.total - lower.total).toBeLessThanOrEqual(Math.round(extraIncome * 1.04));
  });

  it("applies surcharge marginal relief at the ₹50 lakh threshold", () => {
    const below = computeIncomeTax(L(50.7), "new"); // taxable just under ₹50L
    const above = computeIncomeTax(L(51), "new"); // taxable just over ₹50L
    expect(above.surcharge).toBeGreaterThan(0);
    // The jump in total tax cannot exceed the extra income.
    expect(above.total - below.total).toBeLessThanOrEqual(L(51) - L(50.7));
  });

  it("charges a full 10% surcharge once well past the threshold", () => {
    const result = computeIncomeTax(L(70), "new");
    expect(result.surcharge).toBe(Math.round(result.slabTax * 0.1));
  });
});

describe("old regime, FY 2025-26", () => {
  it("charges nothing at ₹5.5 lakh with the standard deduction", () => {
    expect(computeIncomeTax(L(5.5), "old").total).toBe(0);
  });

  it("matches the published figure for a ₹10 lakh salary with no other deductions", () => {
    expect(rupees(computeIncomeTax(L(10), "old").total)).toBe(1_06_600);
  });

  it("reduces tax when Chapter VI-A deductions are supplied", () => {
    const without = computeIncomeTax(L(12), "old", 0);
    const with80c = computeIncomeTax(L(12), "old", L(1.5));
    expect(with80c.total).toBeLessThan(without.total);
    expect(with80c.taxableIncome).toBe(without.taxableIncome - L(1.5));
  });
});

describe("slabTax", () => {
  it("is zero at and below the first slab ceiling", () => {
    expect(slabTax(L(4), NEW_REGIME_SLABS)).toBe(0);
  });

  it("is monotonic", () => {
    let previous = -1;
    for (let lakhs = 0; lakhs <= 60; lakhs += 0.5) {
      const tax = slabTax(L(lakhs), NEW_REGIME_SLABS);
      expect(tax).toBeGreaterThanOrEqual(previous);
      previous = tax;
    }
  });

  it("treats negative income as zero", () => {
    expect(slabTax(-1000, NEW_REGIME_SLABS)).toBe(0);
  });
});
