import { india } from "@probes/core";
import { FIXED_CASH_KEYS, componentValue } from "./parse.ts";
import type { ComponentKey, ParseResult } from "./parse.ts";

/**
 * Turn a parsed CTC breakup into the numbers a candidate actually cares about:
 * what lands in the bank each month, and how much of the headline CTC is
 * conditional on something other than showing up for work.
 *
 * Everything here is deterministic arithmetic against published FY 2025-26
 * rules. No model is involved, which is why the assumptions can be listed and
 * checked line by line.
 */

export type SalaryInput = {
  parsed: ParseResult;
  state: india.StateCode;
  pfBasis: india.PfBasis;
  /**
   * Chapter VI-A deductions the candidate expects to claim, for the old-regime
   * comparison. Employee PF is added automatically.
   */
  extraOldRegimeDeductions: number;
  /** Realistic variable-pay payout ratio for the downside case. */
  downsidePayoutRatio: number;
};

export type RegimeOutcome = {
  regime: india.Regime;
  tax: india.TaxBreakdown;
  monthlyInHand: number;
  annualInHand: number;
};

export type SalaryResult = {
  financialYear: string;
  /** Headline number from the letter, or reconstructed from components. */
  ctc: number;
  ctcWasStated: boolean;

  fixedCash: number;
  employerPf: number;
  employeePf: number;
  gratuityProvision: number;
  medicalOrInsurance: number;
  variablePay: number;
  joiningBonus: number;
  retentionBonus: number;
  esop: number;

  /** CTC minus everything that is not guaranteed monthly cash. */
  guaranteedCashAnnual: number;
  /** Share of CTC that is conditional (variable, ESOP, one-time bonuses). */
  conditionalPct: number;
  /** Share of CTC that never reaches the bank as salary (PF, gratuity, insurance). */
  nonCashPct: number;

  professionalTax: number;
  professionalTaxLabel: string;

  best: RegimeOutcome;
  regimes: RegimeOutcome[];

  /** Take-home if variable pays out fully, and at the downside ratio. */
  monthlyInHand: number;
  monthlyInHandDownside: number;
  variableAtFullPayout: number;
  variableAtDownside: number;

  /** Every assumption made, rendered verbatim in the UI and the PDF. */
  assumptions: string[];
  /** Things the letter did not say that materially change the answer. */
  gaps: string[];
};

/**
 * When a letter gives only a CTC number, fall back to the structure most
 * Indian employers actually use. Clearly flagged as an assumption; the user
 * is told the estimate is coarse.
 */
function assumeStructure(ctc: number): { basic: number; hra: number; special: number } {
  // Employer PF (12% of basic) and gratuity (4.81% of basic) come out of CTC,
  // so basic is solved against the CTC rather than applied to it.
  const basic = Math.round((ctc * 0.4) / (1 + india.EPF_RATE + india.GRATUITY_RATE));
  const hra = Math.round(basic * 0.5);
  const special = Math.max(
    0,
    ctc - basic - hra - Math.round(basic * india.EPF_RATE) - Math.round(basic * india.GRATUITY_RATE),
  );
  return { basic, hra, special };
}

export function computeSalary(input: SalaryInput): SalaryResult {
  const { parsed, state, pfBasis } = input;
  const assumptions: string[] = [];
  const gaps: string[] = [];

  const statedCtc = componentValue(parsed, "totalCtc");
  let basic = componentValue(parsed, "basic");
  let hra = componentValue(parsed, "hra");
  let otherFixed = FIXED_CASH_KEYS.filter((k) => k !== "basic" && k !== "hra").reduce(
    (sum, key) => sum + componentValue(parsed, key),
    0,
  );

  const variablePay = componentValue(parsed, "variablePay");
  const joiningBonus = componentValue(parsed, "joiningBonus");
  const retentionBonus = componentValue(parsed, "retentionBonus");
  const esop = componentValue(parsed, "esop");
  const medicalOrInsurance = componentValue(parsed, "medicalOrInsurance");
  const statedEmployerPf = componentValue(parsed, "employerPf");
  const statedGratuity = componentValue(parsed, "gratuity");

  // --- reconstruct a missing breakup ---------------------------------------
  if (basic === 0) {
    const base =
      statedCtc > 0
        ? statedCtc - variablePay - joiningBonus - retentionBonus - esop - medicalOrInsurance
        : 0;
    if (base > 0) {
      const assumed = assumeStructure(base);
      basic = assumed.basic;
      hra = hra || assumed.hra;
      otherFixed = otherFixed || assumed.special;
      assumptions.push(
        "The letter didn't break out basic pay, so we assumed the common Indian structure: basic ≈ 40% of the fixed portion, HRA = 50% of basic, the rest as special allowance.",
      );
      gaps.push(
        "No component-wise breakup. Ask HR for one — a lower basic means less PF and less gratuity, and that changes this estimate by thousands a month.",
      );
    }
  }

  const pf = india.computePf(basic, pfBasis);
  const employerPf = statedEmployerPf > 0 ? statedEmployerPf : pf.employerAnnual;
  const employeePf = pf.employeeAnnual;
  const gratuityProvision =
    statedGratuity > 0 ? statedGratuity : india.computeGratuityProvision(basic);

  if (statedEmployerPf === 0 && basic > 0) {
    assumptions.push(
      `Employer PF assumed at 12% of basic (${pfBasis === "wage-ceiling" ? "capped at the ₹15,000 statutory wage ceiling" : "on full basic, as most IT employers do"}).`,
    );
  }
  if (statedGratuity === 0 && basic > 0) {
    assumptions.push("Gratuity provisioned at 4.81% of basic, the standard CTC convention.");
  }

  const fixedCash = basic + hra + otherFixed;

  const reconstructedCtc =
    fixedCash +
    employerPf +
    gratuityProvision +
    medicalOrInsurance +
    variablePay +
    joiningBonus +
    retentionBonus +
    esop;
  const ctc = statedCtc > 0 ? statedCtc : reconstructedCtc;

  if (statedCtc === 0) {
    assumptions.push("No total CTC was stated, so it was added up from the components we found.");
  }

  // --- statutory deductions -------------------------------------------------
  const ptRule = india.professionalTaxAnnual(state);
  const professionalTax = ptRule.annual;
  if (state === "OTHER") {
    gaps.push("Work state wasn't given. Pick it above — professional tax differs by state, and several states charge nothing.");
  }

  // --- tax ------------------------------------------------------------------
  // Taxable salary excludes gratuity provision (not received) and insurance
  // premium, and includes employer PF only above the ₹7.5 lakh exemption.
  const taxableBase = fixedCash + variablePay + joiningBonus + retentionBonus;
  const employerPfPerquisite = Math.max(0, employerPf - india.EMPLOYER_PF_TAX_FREE_ANNUAL);
  const grossTaxable = taxableBase + employerPfPerquisite;

  if (employerPfPerquisite > 0) {
    assumptions.push(
      "Employer PF above ₹7.5 lakh a year is treated as a taxable perquisite, as the law requires.",
    );
  }

  const newRegime = india.computeIncomeTax(grossTaxable, "new");
  const oldRegime = india.computeIncomeTax(
    grossTaxable,
    "old",
    employeePf + Math.max(0, input.extraOldRegimeDeductions),
  );

  const buildOutcome = (tax: india.TaxBreakdown): RegimeOutcome => {
    // Monthly take-home counts only guaranteed monthly cash; the tax on
    // variable pay is deducted when the variable is paid, not monthly.
    const annualTaxOnFixed = Math.round(
      tax.total * (taxableBase > 0 ? (fixedCash + employerPfPerquisite) / taxableBase : 1),
    );
    const annualInHand = fixedCash - employeePf - professionalTax - annualTaxOnFixed;
    return {
      regime: tax.regime,
      tax,
      annualInHand,
      monthlyInHand: Math.round(annualInHand / 12),
    };
  };

  const outcomes = [buildOutcome(newRegime), buildOutcome(oldRegime)];
  const best = outcomes.reduce((a, b) => (a.tax.total <= b.tax.total ? a : b));

  assumptions.push(
    `Income tax computed under the ${best.regime === "new" ? "new" : "old"} regime for FY ${india.FINANCIAL_YEAR} (AY ${india.ASSESSMENT_YEAR}), which works out cheaper for these numbers.`,
  );
  assumptions.push(
    "The old-regime figure only uses deductions we can see: standard deduction and your own PF. If you claim HRA exemption, 80D, or a home-loan interest deduction, the old regime may beat this.",
  );
  assumptions.push(`Professional tax: ${ptRule.label}.`);
  assumptions.push(
    "Monthly take-home spreads the tax on fixed pay evenly over twelve months. Your employer's actual TDS schedule will vary month to month.",
  );

  // --- reality checks -------------------------------------------------------
  const conditional = variablePay + joiningBonus + retentionBonus + esop;
  const nonCash = employerPf + gratuityProvision + medicalOrInsurance;

  const variableAtFullPayout = variablePay;
  const variableAtDownside = Math.round(variablePay * input.downsidePayoutRatio);
  const downsideDelta = Math.round((variableAtFullPayout - variableAtDownside) / 12);

  if (variablePay > 0) {
    gaps.push(
      "Ask what the variable component actually paid out across the company last year, as a percentage. The number in the letter is a ceiling, not a promise.",
    );
  }
  if (esop > 0) {
    gaps.push(
      "The ESOP/RSU figure in a CTC is a valuation, not cash. Ask for: strike price, current fair market value, vesting schedule and cliff, what happens if you leave, and whether there is any way to sell.",
    );
  }
  if (joiningBonus > 0) {
    gaps.push(
      "Joining bonuses almost always carry a clawback. Check exactly how long you must stay and whether the repayment is the gross or the net amount.",
    );
  }
  if (medicalOrInsurance > 0) {
    gaps.push(
      "Insurance premium sits in your CTC but never reaches you as money. Worth knowing the cover amount and whether parents are included.",
    );
  }

  return {
    financialYear: india.FINANCIAL_YEAR,
    ctc,
    ctcWasStated: statedCtc > 0,
    fixedCash,
    employerPf,
    employeePf,
    gratuityProvision,
    medicalOrInsurance,
    variablePay,
    joiningBonus,
    retentionBonus,
    esop,
    guaranteedCashAnnual: fixedCash,
    conditionalPct: ctc > 0 ? Number(((conditional / ctc) * 100).toFixed(1)) : 0,
    nonCashPct: ctc > 0 ? Number(((nonCash / ctc) * 100).toFixed(1)) : 0,
    professionalTax,
    professionalTaxLabel: ptRule.label,
    best,
    regimes: outcomes,
    monthlyInHand: best.monthlyInHand,
    monthlyInHandDownside: best.monthlyInHand - downsideDelta,
    variableAtFullPayout,
    variableAtDownside,
    assumptions,
    gaps,
  };
}

/** Component rows for the result table, in the order people expect to read them. */
export const DISPLAY_ORDER: { key: ComponentKey; label: string; group: string }[] = [
  { key: "basic", label: "Basic", group: "Fixed cash" },
  { key: "hra", label: "House rent allowance", group: "Fixed cash" },
  { key: "specialAllowance", label: "Special / flexible allowance", group: "Fixed cash" },
  { key: "lta", label: "Leave travel allowance", group: "Fixed cash" },
  { key: "conveyance", label: "Conveyance", group: "Fixed cash" },
  { key: "foodAllowance", label: "Food allowance", group: "Fixed cash" },
  { key: "telephoneOrInternet", label: "Telephone / internet", group: "Fixed cash" },
  { key: "otherFixed", label: "Other fixed", group: "Fixed cash" },
  { key: "employerPf", label: "Employer PF", group: "In CTC, not in your bank" },
  { key: "gratuity", label: "Gratuity provision", group: "In CTC, not in your bank" },
  { key: "medicalOrInsurance", label: "Insurance premium", group: "In CTC, not in your bank" },
  { key: "variablePay", label: "Variable / performance pay", group: "Conditional" },
  { key: "joiningBonus", label: "Joining bonus", group: "Conditional" },
  { key: "retentionBonus", label: "Retention bonus", group: "Conditional" },
  { key: "esop", label: "ESOP / RSU", group: "Conditional" },
];
