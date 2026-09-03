export {
  FINANCIAL_YEAR,
  ASSESSMENT_YEAR,
  NEW_REGIME_SLABS,
  OLD_REGIME_SLABS,
  STANDARD_DEDUCTION,
  computeIncomeTax,
  slabTax,
} from "./tax.ts";
export type { Regime, Slab, TaxBreakdown } from "./tax.ts";

export {
  EPF_RATE,
  EPF_WAGE_CEILING_MONTHLY,
  EMPLOYER_PF_TAX_FREE_ANNUAL,
  GRATUITY_RATE,
  GRATUITY_EXEMPTION_CAP,
  PROFESSIONAL_TAX_STATES,
  computePf,
  computeGratuityProvision,
  gratuityPayableAfter,
  professionalTaxAnnual,
  isStateCode,
} from "./statutory.ts";
export type { PfBasis, PfResult, StateCode } from "./statutory.ts";
