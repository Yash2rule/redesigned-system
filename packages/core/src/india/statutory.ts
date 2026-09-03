/**
 * Provident fund, gratuity and professional tax — the three things that make
 * an Indian CTC number differ from what lands in a bank account.
 *
 * FY 2025-26. All amounts in minor units (paise).
 */

/** EPF statutory wage ceiling: ₹15,000 per month. */
export const EPF_WAGE_CEILING_MONTHLY = 15_000 * 100;

export const EPF_RATE = 0.12;

/** Employer PF above this annual figure is a taxable perquisite (Sec 17(2)(vii)). */
export const EMPLOYER_PF_TAX_FREE_ANNUAL = 750_000 * 100;

/** Gratuity is commonly provisioned in CTC at 4.81% of annual basic. */
export const GRATUITY_RATE = 0.0481;

/** Gratuity exemption ceiling for non-government employees. */
export const GRATUITY_EXEMPTION_CAP = 2_000_000 * 100;

export type PfBasis = "full-basic" | "wage-ceiling";

export type PfResult = {
  basis: PfBasis;
  /** Monthly wage PF is calculated on. */
  pfWageMonthly: number;
  employeeAnnual: number;
  employerAnnual: number;
  /** Portion of employer PF that is a taxable perquisite this year. */
  employerTaxablePerquisite: number;
};

/**
 * @param annualBasic Annual basic (+ DA) in paise.
 * @param basis Most Indian IT employers compute PF on full basic; smaller
 *   employers cap it at the ₹15,000 statutory wage ceiling. Which one applies
 *   changes take-home by a few thousand rupees a month, so it is an explicit
 *   input rather than a silent assumption.
 */
export function computePf(annualBasic: number, basis: PfBasis = "full-basic"): PfResult {
  const monthlyBasic = annualBasic / 12;
  const pfWageMonthly =
    basis === "wage-ceiling" ? Math.min(monthlyBasic, EPF_WAGE_CEILING_MONTHLY) : monthlyBasic;

  const monthly = Math.round(pfWageMonthly * EPF_RATE);
  const annual = monthly * 12;

  return {
    basis,
    pfWageMonthly: Math.round(pfWageMonthly),
    employeeAnnual: annual,
    employerAnnual: annual,
    employerTaxablePerquisite: Math.max(0, annual - EMPLOYER_PF_TAX_FREE_ANNUAL),
  };
}

export function computeGratuityProvision(annualBasic: number): number {
  return Math.round(annualBasic * GRATUITY_RATE);
}

/**
 * Gratuity actually payable on leaving: 15 days' basic per completed year,
 * and nothing at all before 5 years of continuous service.
 */
export function gratuityPayableAfter(annualBasic: number, years: number): number {
  if (years < 5) return 0;
  const monthlyBasic = annualBasic / 12;
  return Math.min(Math.round((monthlyBasic * 15 * Math.floor(years)) / 26), GRATUITY_EXEMPTION_CAP);
}

export type StateCode =
  | "KA" | "MH" | "TN" | "TS" | "AP" | "WB" | "GJ" | "MP" | "KL" | "OR" | "BR" | "AS" | "JH" | "CG"
  | "DL" | "UP" | "HR" | "PB" | "RJ" | "UK" | "GA" | "JK" | "HP" | "CH" | "OTHER";

type PtRule = { annual: number; label: string };

/**
 * Professional tax is levied by state, capped at ₹2,500 a year by Article 276.
 * Only the salary bands that matter for a typical white-collar offer are
 * modelled; below those bands the figure is lower and we say so.
 */
const PROFESSIONAL_TAX: Record<StateCode, PtRule> = {
  KA: { annual: 2400 * 100, label: "Karnataka: ₹200/month above ₹25,000 monthly salary" },
  MH: { annual: 2500 * 100, label: "Maharashtra: ₹200/month, ₹300 in February" },
  TN: { annual: 2500 * 100, label: "Tamil Nadu: half-yearly slabs, ₹1,250 each at higher salaries" },
  TS: { annual: 2400 * 100, label: "Telangana: ₹200/month above ₹20,000 monthly salary" },
  AP: { annual: 2400 * 100, label: "Andhra Pradesh: ₹200/month above ₹20,000 monthly salary" },
  WB: { annual: 2400 * 100, label: "West Bengal: ₹200/month above ₹40,000 monthly salary" },
  GJ: { annual: 2400 * 100, label: "Gujarat: ₹200/month above ₹12,000 monthly salary" },
  MP: { annual: 2500 * 100, label: "Madhya Pradesh: ₹208/month, ₹212 in the last month" },
  KL: { annual: 2500 * 100, label: "Kerala: half-yearly, ₹1,250 each at higher salaries" },
  OR: { annual: 2500 * 100, label: "Odisha: ₹200/month, ₹300 in the last month" },
  BR: { annual: 2500 * 100, label: "Bihar: ₹208/month approximately" },
  AS: { annual: 2500 * 100, label: "Assam: ₹208/month approximately" },
  JH: { annual: 2500 * 100, label: "Jharkhand: ₹208/month approximately" },
  CG: { annual: 2400 * 100, label: "Chhattisgarh: ₹200/month at higher salaries" },
  DL: { annual: 0, label: "Delhi does not levy professional tax" },
  UP: { annual: 0, label: "Uttar Pradesh does not levy professional tax" },
  HR: { annual: 0, label: "Haryana does not levy professional tax" },
  PB: { annual: 2400 * 100, label: "Punjab: ₹200/month for taxable-income earners" },
  RJ: { annual: 0, label: "Rajasthan does not levy professional tax" },
  UK: { annual: 0, label: "Uttarakhand does not levy professional tax on most salaries" },
  GA: { annual: 2500 * 100, label: "Goa: ₹200/month at higher salaries" },
  JK: { annual: 0, label: "Jammu & Kashmir does not levy professional tax" },
  HP: { annual: 0, label: "Himachal Pradesh does not levy professional tax on most salaries" },
  CH: { annual: 0, label: "Chandigarh does not levy professional tax" },
  OTHER: { annual: 2400 * 100, label: "State not given — assumed ₹200/month, the most common rate" },
};

export const PROFESSIONAL_TAX_STATES: { code: StateCode; label: string }[] = (
  Object.keys(PROFESSIONAL_TAX) as StateCode[]
).map((code) => ({ code, label: PROFESSIONAL_TAX[code].label }));

export function professionalTaxAnnual(state: StateCode): PtRule {
  return PROFESSIONAL_TAX[state] ?? PROFESSIONAL_TAX.OTHER;
}

export function isStateCode(value: unknown): value is StateCode {
  return typeof value === "string" && value in PROFESSIONAL_TAX;
}
