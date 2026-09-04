/**
 * Indian personal income tax, FY 2025-26 (assessment year 2026-27).
 *
 * Every number in this file has an effective financial year attached and is
 * surfaced to the user alongside the result. This is drafting and explanation
 * assistance, not tax advice — the point of showing the slabs, the rebate and
 * the surcharge separately is so that a chartered accountant can check the
 * arithmetic in thirty seconds.
 *
 * All amounts are in MINOR units (paise).
 */

export const FINANCIAL_YEAR = "2025-26";
export const ASSESSMENT_YEAR = "2026-27";

const L = (lakhs: number): number => Math.round(lakhs * 100_000 * 100);

export type Regime = "new" | "old";

export type Slab = { upTo: number | null; rate: number };

/** Default regime since FY 2023-24 unless the taxpayer opts out. */
export const NEW_REGIME_SLABS: Slab[] = [
  { upTo: L(4), rate: 0 },
  { upTo: L(8), rate: 0.05 },
  { upTo: L(12), rate: 0.1 },
  { upTo: L(16), rate: 0.15 },
  { upTo: L(20), rate: 0.2 },
  { upTo: L(24), rate: 0.25 },
  { upTo: null, rate: 0.3 },
];

export const OLD_REGIME_SLABS: Slab[] = [
  { upTo: L(2.5), rate: 0 },
  { upTo: L(5), rate: 0.05 },
  { upTo: L(10), rate: 0.2 },
  { upTo: null, rate: 0.3 },
];

export const STANDARD_DEDUCTION: Record<Regime, number> = {
  new: L(0.75), // ₹75,000
  old: L(0.5), // ₹50,000
};

/** Section 87A: full rebate below the threshold, capped at the maximum. */
const REBATE_87A: Record<Regime, { incomeLimit: number; maxRebate: number }> = {
  new: { incomeLimit: L(12), maxRebate: L(0.6) }, // ₹12,00,000 / ₹60,000
  old: { incomeLimit: L(5), maxRebate: L(0.125) }, // ₹5,00,000 / ₹12,500
};

const CESS_RATE = 0.04;

/** Surcharge is capped at 25% under the new regime (37% still exists in old). */
const SURCHARGE_BANDS: Record<Regime, { over: number; rate: number }[]> = {
  new: [
    { over: L(50), rate: 0.1 },
    { over: L(100), rate: 0.15 },
    { over: L(200), rate: 0.25 },
  ],
  old: [
    { over: L(50), rate: 0.1 },
    { over: L(100), rate: 0.15 },
    { over: L(200), rate: 0.25 },
    { over: L(500), rate: 0.37 },
  ],
};

export function slabTax(income: number, slabs: Slab[]): number {
  let remaining = Math.max(income, 0);
  let previous = 0;
  let tax = 0;
  for (const slab of slabs) {
    const ceiling = slab.upTo ?? Number.POSITIVE_INFINITY;
    const band = Math.min(remaining, Math.max(ceiling - previous, 0));
    if (band <= 0) break;
    tax += band * slab.rate;
    remaining -= band;
    previous = ceiling;
    if (remaining <= 0) break;
  }
  return Math.round(tax);
}

/** The surcharge rate that applies at a given taxable income. */
function surchargeRate(income: number, regime: Regime): number {
  let rate = 0;
  for (const band of SURCHARGE_BANDS[regime]) if (income > band.over) rate = band.rate;
  return rate;
}

/** Tax + surcharge (before cess) at a given income, ignoring marginal relief. */
function taxPlusSurchargeAt(income: number, regime: Regime): number {
  const slabs = regime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const base = slabTax(income, slabs);
  return base + Math.round(base * surchargeRate(income, regime));
}

/**
 * Surcharge with marginal relief.
 *
 * Relief rule: crossing a surcharge threshold can never cost more in extra tax
 * than the extra income earned. Without it, ₹1 over ₹50 lakh would cost about
 * ₹1.3 lakh — a cliff that makes an offer comparison actively misleading.
 */
function surchargeFor(income: number, taxAfterRebate: number, regime: Regime): number {
  const bands = SURCHARGE_BANDS[regime];
  let applicable: { over: number; rate: number } | null = null;
  for (const band of bands) if (income > band.over) applicable = band;
  if (!applicable) return 0;

  const raw = Math.round(taxAfterRebate * applicable.rate);

  // Payable at exactly the threshold, where this band does not yet bite.
  const atThreshold = taxPlusSurchargeAt(applicable.over, regime);
  const cap = atThreshold + (income - applicable.over) - taxAfterRebate;
  return Math.max(0, Math.min(raw, Math.round(cap)));
}

export type TaxBreakdown = {
  regime: Regime;
  /** Income after the standard deduction. */
  taxableIncome: number;
  slabTax: number;
  rebate87A: number;
  surcharge: number;
  cess: number;
  /** Total tax payable for the year, including cess. */
  total: number;
  /** total / grossIncome, as a percentage, for the "effective rate" line. */
  effectiveRatePct: number;
  notes: string[];
};

/**
 * @param grossTaxableSalary Salary income before the standard deduction.
 * @param otherDeductions Chapter VI-A deductions (old regime only).
 */
export function computeIncomeTax(
  grossTaxableSalary: number,
  regime: Regime,
  otherDeductions = 0,
): TaxBreakdown {
  const notes: string[] = [];
  const slabs = regime === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const deductions =
    STANDARD_DEDUCTION[regime] + (regime === "old" ? Math.max(otherDeductions, 0) : 0);
  const taxableIncome = Math.max(grossTaxableSalary - deductions, 0);

  const base = slabTax(taxableIncome, slabs);

  const rebateRule = REBATE_87A[regime];
  let rebate = taxableIncome <= rebateRule.incomeLimit ? Math.min(base, rebateRule.maxRebate) : 0;
  let afterRebate = base - rebate;

  // Marginal relief on 87A: just above the limit, tax cannot exceed the amount
  // by which income exceeds the limit. Without this, earning ₹1 more than
  // ₹12,00,000 would cost roughly ₹60,000 in tax.
  if (rebate === 0 && taxableIncome > rebateRule.incomeLimit) {
    const excess = taxableIncome - rebateRule.incomeLimit;
    if (afterRebate > excess) {
      rebate = afterRebate - excess;
      afterRebate = excess;
      notes.push(
        `Marginal relief applied: income is just above ₹${(rebateRule.incomeLimit / 100 / 100000).toFixed(0)} lakh, so tax is capped at the amount above that limit.`,
      );
    }
  }

  const surcharge = surchargeFor(taxableIncome, afterRebate, regime);
  if (surcharge > 0) notes.push("Surcharge applies because taxable income is above ₹50 lakh.");

  const cess = Math.round((afterRebate + surcharge) * CESS_RATE);
  const total = afterRebate + surcharge + cess;

  return {
    regime,
    taxableIncome,
    slabTax: base,
    rebate87A: rebate,
    surcharge,
    cess,
    total,
    effectiveRatePct:
      grossTaxableSalary > 0 ? Number(((total / grossTaxableSalary) * 100).toFixed(2)) : 0,
    notes,
  };
}
