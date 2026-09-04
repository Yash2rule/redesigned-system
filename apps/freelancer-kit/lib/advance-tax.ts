import { UserFacingError, india } from "@probes/core";

/**
 * Advance tax schedule for a freelancer, FY 2025-26.
 *
 * The detail that makes this worth building: a professional taxed under
 * section 44ADA pays advance tax in ONE instalment by 15 March, not in four.
 * Almost every online advance-tax calculator shows the four-instalment
 * schedule regardless, which makes freelancers think they are late in June
 * when they are not — or, worse, lets them believe the June and September
 * dates do not apply when they have opted out of 44ADA.
 *
 * This is arithmetic against published rules and a schedule of dates. It is
 * explanation assistance, not tax advice, and it files nothing.
 */

export type TaxBasis = "presumptive-44ada" | "actual-books";

export type AdvanceTaxInput = {
  /** Gross professional receipts expected for the year, in paise. */
  grossReceiptsMinor: number;
  /** Business expenses, used only when basis is actual-books. */
  expensesMinor: number;
  /** Other income: interest, rent, capital gains, in paise. */
  otherIncomeMinor: number;
  basis: TaxBasis;
  regime: india.Regime;
  /** Chapter VI-A deductions claimed (old regime only). */
  deductionsMinor: number;
  /** TDS already deducted by clients, in paise. */
  tdsDeductedMinor: number;
  /** Advance tax already paid this year, in paise. */
  alreadyPaidMinor: number;
};

export type Instalment = {
  dueDate: string;
  label: string;
  /** Cumulative percentage of the year's liability due by this date. */
  cumulativePct: number;
  cumulativeMinor: number;
  /** Amount due at this instalment alone. */
  instalmentMinor: number;
  status: "past" | "due-soon" | "upcoming";
  daysAway: number;
};

export type AdvanceTaxResult = {
  financialYear: string;
  assessmentYear: string;
  basis: TaxBasis;
  presumptiveProfitMinor: number | null;
  netProfessionalIncomeMinor: number;
  totalIncomeMinor: number;
  tax: india.TaxBreakdown;
  regimeCompared: { regime: india.Regime; totalMinor: number }[];
  /** Tax payable after TDS. Advance tax is only due when this is ≥ ₹10,000. */
  liabilityAfterTdsMinor: number;
  advanceTaxDue: boolean;
  remainingToPayMinor: number;
  instalments: Instalment[];
  notes: string[];
  warnings: string[];
};

/** Section 208: no advance tax unless the liability after TDS reaches ₹10,000. */
const ADVANCE_TAX_THRESHOLD = 10_000 * 100;

/** Section 44ADA: 50% of gross receipts deemed to be profit. */
const PRESUMPTIVE_RATE = 0.5;

/** 44ADA ceiling, ₹75 lakh where cash receipts are at most 5%. */
const PRESUMPTIVE_LIMIT = 75_00_000 * 100;

/** The financial year this build's rules are for. */
const FY_START_YEAR = 2025;

type Schedule = { month: number; day: number; pct: number; label: string };

const FOUR_INSTALMENTS: Schedule[] = [
  { month: 6, day: 15, pct: 15, label: "First instalment" },
  { month: 9, day: 15, pct: 45, label: "Second instalment" },
  { month: 12, day: 15, pct: 75, label: "Third instalment" },
  { month: 3, day: 15, pct: 100, label: "Fourth instalment" },
];

const SINGLE_INSTALMENT: Schedule[] = [
  { month: 3, day: 15, pct: 100, label: "Single instalment (section 44ADA)" },
];

function dueDateFor(entry: Schedule): string {
  // The financial year runs April to March, so January to March fall in the
  // following calendar year.
  const year = entry.month >= 4 ? FY_START_YEAR : FY_START_YEAR + 1;
  return `${year}-${String(entry.month).padStart(2, "0")}-${String(entry.day).padStart(2, "0")}`;
}

export function computeAdvanceTax(
  input: AdvanceTaxInput,
  now: Date = new Date(),
): AdvanceTaxResult {
  const notes: string[] = [];
  const warnings: string[] = [];

  if (input.grossReceiptsMinor < 0 || input.expensesMinor < 0) {
    throw new UserFacingError("Receipts and expenses can't be negative.", 400);
  }

  // --- professional income --------------------------------------------------
  let presumptiveProfitMinor: number | null = null;
  let netProfessionalIncomeMinor: number;

  if (input.basis === "presumptive-44ada") {
    if (input.grossReceiptsMinor > PRESUMPTIVE_LIMIT) {
      throw new UserFacingError(
        `Section 44ADA only applies up to ₹75 lakh of gross receipts (and only when at most 5% of receipts are in cash). Your figure is above that, so choose "actual books" instead.`,
        400,
      );
    }
    presumptiveProfitMinor = Math.round(input.grossReceiptsMinor * PRESUMPTIVE_RATE);
    netProfessionalIncomeMinor = presumptiveProfitMinor;
    notes.push(
      "Under section 44ADA, 50% of gross professional receipts is deemed to be your profit, and you do not have to maintain books or claim expenses individually.",
    );
    if (input.expensesMinor > presumptiveProfitMinor) {
      warnings.push(
        "Your stated expenses are more than half your receipts, so declaring actual profit would probably mean less tax than the presumptive 50%. Under actual books you must keep proper records and may need a tax audit — worth a conversation with a CA.",
      );
    }
  } else {
    netProfessionalIncomeMinor = Math.max(0, input.grossReceiptsMinor - input.expensesMinor);
    notes.push(
      "Profit computed as receipts minus the expenses you entered. Under actual books you must keep records supporting each expense.",
    );
  }

  const totalIncomeMinor = netProfessionalIncomeMinor + Math.max(0, input.otherIncomeMinor);

  // --- tax ------------------------------------------------------------------
  // The standard deduction is a salary deduction and a freelancer with no
  // salary income cannot claim it. computeIncomeTax subtracts it
  // unconditionally, so the income handed to it is grossed up by exactly that
  // amount to cancel it out. Doing it here keeps one tax engine shared with
  // the offer decoder rather than forking a second, drifting copy.
  const taxFor = (regime: india.Regime) =>
    india.computeIncomeTax(
      totalIncomeMinor + india.STANDARD_DEDUCTION[regime],
      regime,
      regime === "old" ? input.deductionsMinor : 0,
    );

  const tax = taxFor(input.regime);
  const regimeCompared = (["new", "old"] as india.Regime[]).map((regime) => ({
    regime,
    totalMinor: taxFor(regime).total,
  }));

  const cheaper = regimeCompared.reduce((a, b) => (a.totalMinor <= b.totalMinor ? a : b));
  if (cheaper.regime !== input.regime) {
    warnings.push(
      `The ${cheaper.regime} regime would cost about ${Math.round((tax.total - cheaper.totalMinor) / 100).toLocaleString("en-IN")} rupees less on these numbers. Switch the regime above to compare properly.`,
    );
  }

  const liabilityAfterTdsMinor = Math.max(0, tax.total - Math.max(0, input.tdsDeductedMinor));
  const advanceTaxDue = liabilityAfterTdsMinor >= ADVANCE_TAX_THRESHOLD;

  if (!advanceTaxDue) {
    notes.push(
      "Your tax after TDS is below ₹10,000, so no advance tax is payable this year (section 208). You still file a return.",
    );
  }

  // --- schedule -------------------------------------------------------------
  const schedule = input.basis === "presumptive-44ada" ? SINGLE_INSTALMENT : FOUR_INSTALMENTS;
  if (input.basis === "presumptive-44ada") {
    notes.push(
      "Because you are taxed under section 44ADA, the whole of your advance tax is payable in one instalment by 15 March. The June, September and December dates do not apply to you.",
    );
  } else {
    notes.push(
      "Advance tax under actual books is payable in four instalments: 15% by 15 June, 45% cumulative by 15 September, 75% by 15 December and 100% by 15 March.",
    );
  }

  let previousCumulative = 0;
  const instalments: Instalment[] = schedule.map((entry) => {
    const dueDate = dueDateFor(entry);
    const cumulativeMinor = advanceTaxDue
      ? Math.round((liabilityAfterTdsMinor * entry.pct) / 100)
      : 0;
    const instalmentMinor = cumulativeMinor - previousCumulative;
    previousCumulative = cumulativeMinor;

    const daysAway = Math.ceil(
      (new Date(`${dueDate}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000,
    );
    return {
      dueDate,
      label: entry.label,
      cumulativePct: entry.pct,
      cumulativeMinor,
      instalmentMinor,
      status: daysAway < 0 ? "past" : daysAway <= 30 ? "due-soon" : "upcoming",
      daysAway,
    };
  });

  const missed = instalments.filter((i) => i.status === "past" && i.cumulativeMinor > input.alreadyPaidMinor);
  if (advanceTaxDue && missed.length > 0) {
    warnings.push(
      `${missed.length} instalment date${missed.length === 1 ? " has" : "s have"} already passed with less paid than was due. Section 234C charges simple interest at 1% a month on the shortfall — usually three months' worth for the first three instalments and one month for the last. We have not computed that interest, because it depends on exactly what you paid and when.`,
    );
  }

  warnings.push(
    "This is an estimate from the figures you entered. If your income changes during the year, recompute — advance tax is charged on what you actually earn, not on what you projected in April.",
  );

  return {
    financialYear: india.FINANCIAL_YEAR,
    assessmentYear: india.ASSESSMENT_YEAR,
    basis: input.basis,
    presumptiveProfitMinor,
    netProfessionalIncomeMinor,
    totalIncomeMinor,
    tax,
    regimeCompared,
    liabilityAfterTdsMinor,
    advanceTaxDue,
    remainingToPayMinor: Math.max(0, liabilityAfterTdsMinor - Math.max(0, input.alreadyPaidMinor)),
    instalments,
    notes,
    warnings,
  };
}
