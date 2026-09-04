import { UserFacingError, india } from "@probes/core/server";
import type { IngestResult } from "@probes/core/server";
import { benchmarkOffer } from "./benchmark.ts";
import type { BenchmarkResult } from "./benchmark.ts";
import { parseOfferText } from "./parse.ts";
import type { ParsedComponent } from "./parse.ts";
import { detectMissingClauses, detectRedFlags } from "./redflags.ts";
import type { RedFlag } from "./redflags.ts";
import { computeSalary } from "./salary.ts";
import type { SalaryResult } from "./salary.ts";

export type DecodeOptions = {
  state: india.StateCode;
  pfBasis: india.PfBasis;
  extraOldRegimeDeductions: number;
  downsidePayoutRatio: number;
};

export type DecodeResult = {
  salary: SalaryResult;
  components: ParsedComponent[];
  unmatched: { label: string; annual: number }[];
  redFlags: RedFlag[];
  missingClauses: string[];
  benchmark: BenchmarkResult;
  /** What the parser could and could not find, shown to the user verbatim. */
  parseNotes: string[];
  options: DecodeOptions;
};

export const DEFAULT_OPTIONS: DecodeOptions = {
  state: "OTHER",
  pfBasis: "full-basic",
  extraOldRegimeDeductions: 0,
  // 70% is a deliberately conservative but common real payout for variable pay.
  downsidePayoutRatio: 0.7,
};

/**
 * Read a numeric form field, falling back to the default when the field is
 * absent or blank.
 *
 * `Number(form.get(x))` is wrong here: a missing field is `null`, and
 * `Number(null)` is 0, not NaN. That silently turned "no payout ratio given"
 * into "assume the variable pays nothing", which made every downside figure
 * far too pessimistic.
 */
function readNumber(form: FormData, key: string, fallback: number): number {
  const raw = form.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function readOptions(form: FormData): DecodeOptions {
  const state = form.get("state");
  const pfBasis = form.get("pfBasis");
  const deductions = readNumber(form, "extraOldRegimeDeductions", 0);
  const ratio = readNumber(form, "downsidePayoutRatio", DEFAULT_OPTIONS.downsidePayoutRatio);

  return {
    state: india.isStateCode(state) ? state : DEFAULT_OPTIONS.state,
    pfBasis: pfBasis === "wage-ceiling" ? "wage-ceiling" : "full-basic",
    extraOldRegimeDeductions: deductions > 0 ? Math.round(deductions * 100) : 0,
    downsidePayoutRatio:
      ratio >= 0 && ratio <= 1 ? ratio : DEFAULT_OPTIONS.downsidePayoutRatio,
  };
}

/** Raised when the text has no recognisable salary figures at all. */
export class NoSalaryFoundError extends UserFacingError {
  constructor() {
    super(
      "We couldn't find any salary figures in that. Paste the CTC breakup table — component names on the left, amounts on the right — or at least a line like \"Total CTC: 24,00,000 per annum\".",
    );
    this.name = "NoSalaryFoundError";
  }
}

export async function decodeOffer(
  ingested: IngestResult,
  options: DecodeOptions,
): Promise<DecodeResult> {
  const text = ingested.rows.length > 0
    ? ingested.rows.map((row) => row.join("  ")).join("\n")
    : ingested.text;

  const parsed = parseOfferText(text);

  const hasAnySalary = parsed.components.some(
    (c) => c.key === "basic" || c.key === "totalCtc" || c.key === "grossSalary",
  );
  if (!hasAnySalary) throw new NoSalaryFoundError();

  const salary = computeSalary({
    parsed,
    state: options.state,
    pfBasis: options.pfBasis,
    extraOldRegimeDeductions: options.extraOldRegimeDeductions,
    downsidePayoutRatio: options.downsidePayoutRatio,
  });

  const parseNotes: string[] = [];
  if (parsed.period === "unknown") {
    parseNotes.push(
      "The document didn't say whether the figures were monthly or annual, so we read them as annual. If your in-hand looks twelve times too big, that's why.",
    );
  }
  if (parsed.period === "mixed") {
    parseNotes.push(
      "The document mixes monthly and annual figures. We used the ratio between paired columns to tell them apart — check the component table below against your letter.",
    );
  }
  if (parsed.unmatched.length > 0) {
    parseNotes.push(
      `${parsed.unmatched.length} line${parsed.unmatched.length === 1 ? "" : "s"} looked like a component but didn't match anything we know. They are listed below and were NOT counted in any total.`,
    );
  }

  return {
    salary,
    components: parsed.components,
    unmatched: parsed.unmatched,
    redFlags: detectRedFlags(parsed.text),
    missingClauses: detectMissingClauses(parsed.text),
    benchmark: await benchmarkOffer(salary),
    parseNotes,
    options,
  };
}
