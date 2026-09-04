import { parseIndianAmount } from "@probes/core";

/**
 * Parse an Indian CTC breakup out of pasted text or extracted PDF text.
 *
 * There is no standard format. What there IS, reliably, is a label followed by
 * one or two numbers per line, and a header somewhere saying whether the
 * numbers are monthly or annual. That is what this parses. Anything it cannot
 * place goes into `unmatched` and is shown to the user rather than silently
 * dropped — a component we ignored is exactly the kind of error that makes a
 * salary estimate wrong.
 */

export type ComponentKey =
  | "basic"
  | "hra"
  | "specialAllowance"
  | "lta"
  | "conveyance"
  | "medicalOrInsurance"
  | "foodAllowance"
  | "telephoneOrInternet"
  | "otherFixed"
  | "employerPf"
  | "employeePf"
  | "gratuity"
  | "variablePay"
  | "joiningBonus"
  | "retentionBonus"
  | "esop"
  | "totalCtc"
  | "grossSalary";

/** Cash the employee can actually receive each month, before deductions. */
export const FIXED_CASH_KEYS: ComponentKey[] = [
  "basic",
  "hra",
  "specialAllowance",
  "lta",
  "conveyance",
  "foodAllowance",
  "telephoneOrInternet",
  "otherFixed",
];

type Matcher = { key: ComponentKey; patterns: RegExp[] };

// Order matters: the first match wins, so more specific patterns come first.
const MATCHERS: Matcher[] = [
  { key: "totalCtc", patterns: [/\b(total\s*ctc|cost\s*to\s*company|ctc|total\s*compensation|annual\s*compensation)\b/i] },
  { key: "grossSalary", patterns: [/\b(gross\s*(salary|earnings|pay)|total\s*earnings)\b/i] },
  { key: "employerPf", patterns: [/\b(employer|company)('?s)?\s*(contribution\s*(to\s*)?)?(pf|provident|epf)\b/i, /\b(pf|epf|provident\s*fund)\s*[-(–]?\s*(employer|company)\b/i] },
  { key: "employeePf", patterns: [/\b(employee|your|own)('?s)?\s*(contribution\s*(to\s*)?)?(pf|provident|epf)\b/i, /\b(pf|epf|provident\s*fund)\s*[-(–]?\s*(employee)\b/i] },
  { key: "gratuity", patterns: [/\bgratuity\b/i] },
  { key: "esop", patterns: [/\b(esop|rsu|stock\s*(option|unit|grant|award)|equity|share\s*option)\b/i] },
  { key: "joiningBonus", patterns: [/\b(joining|sign[\s-]*on|signing|welcome)\s*(bonus|amount|incentive)?\b/i] },
  { key: "retentionBonus", patterns: [/\b(retention|loyalty|stay)\s*(bonus|pay|incentive)\b/i] },
  { key: "variablePay", patterns: [/\b(variable|performance|annual)\s*(pay|bonus|component|incentive|linked)/i, /\b(pli|vpi|performance[\s-]*linked|incentive\s*pay|bonus\s*\(?variable)/i] },
  { key: "hra", patterns: [/\b(hra|house\s*rent(\s*allowance)?)\b/i] },
  { key: "lta", patterns: [/\b(lta|leave\s*travel\s*(allowance|assistance|concession)|ltc)\b/i] },
  { key: "conveyance", patterns: [/\b(conveyance|transport|travel|fuel|car)\s*(allowance|reimbursement)?\b/i] },
  { key: "medicalOrInsurance", patterns: [/\b(medical|mediclaim|health|insurance|group\s*term|gpa|gmc|accident\s*cover)\b/i] },
  { key: "foodAllowance", patterns: [/\b(food|meal|sodexo|canteen)\s*(allowance|coupon|card|voucher)?\b/i] },
  { key: "telephoneOrInternet", patterns: [/\b(telephone|mobile|phone|internet|broadband|communication)\s*(allowance|reimbursement)?\b/i] },
  { key: "specialAllowance", patterns: [/\b(special|flexible|flexi|other|balance|residual|supplementary)\s*(allowance|benefit|pay|basket|component)?\b/i, /\bfbp\b/i] },
  { key: "basic", patterns: [/\bbasic(\s*(salary|pay|wage))?\b/i, /\bbasic\s*\+\s*da\b/i] },
];

export type ParsedComponent = {
  key: ComponentKey;
  label: string;
  /** Annual amount in paise. */
  annual: number;
  /** True when we derived the annual figure by multiplying a monthly one. */
  fromMonthly: boolean;
};

export type ParseResult = {
  components: ParsedComponent[];
  /** Lines that looked like components but matched no category. */
  unmatched: { label: string; annual: number }[];
  /** How the document expressed its numbers. */
  period: "annual" | "monthly" | "mixed" | "unknown";
  /** Free-text clause body, used by the red-flag detector. */
  text: string;
};

const PERIOD_ANNUAL = /\b(per\s*annum|p\.?\s*a\.?|annual(ly|ised)?|yearly|per\s*year|annum)\b/i;
const PERIOD_MONTHLY = /\b(per\s*month|p\.?\s*m\.?|monthly|per\s*mensem)\b/i;

function classify(label: string): ComponentKey | null {
  for (const matcher of MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(label))) return matcher.key;
  }
  return null;
}

/**
 * Smallest bare number we will read as money, in paise (₹1,000).
 *
 * Anything below this on a salary line is an index, a clause number or part of
 * a filename. A figure carrying ₹/Rs/INR or a unit like "lakh" is exempt,
 * because there the writer has said what it is.
 */
const MIN_PLAUSIBLE_AMOUNT = 1_000_00;

/** Pull every number-looking token out of a line, with its position. */
function numbersIn(line: string): { value: number; index: number; raw: string }[] {
  const out: { value: number; index: number; raw: string }[] = [];
  // Longest unit alternatives first, so "32 LPA" is thirty-two lakh and not
  // thirty-two rupees followed by stray letters.
  const re =
    /(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(crores|crore|cr|lakhs|lakh|lacs|lac|lpa|l|k)?\b/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const raw = `${match[1] ?? ""}${match[2] ?? ""}`;
    const value = parseIndianAmount(raw);
    if (value === null || value <= 0) continue;
    // Skip things that are obviously not money: years, percentages, counts.
    const after = line.slice(match.index + match[0].length, match.index + match[0].length + 2);
    if (after.trimStart().startsWith("%")) continue;
    if (!match[2] && /^(19|20)\d{2}$/.test(match[1] ?? "")) continue;
    // A bare number with no currency mark and no unit has to be a plausible
    // annual figure before we treat it as one. Without this, the digit inside
    // any identifier that happens to sit on a line — "offer-letter-1.txt",
    // "Form-16", a reference number — became a component worth one rupee.
    // Nothing in a CTC is denominated in single rupees.
    const marked = /^\s*(?:₹|rs\.?|inr)/i.test(match[0]);
    if (!marked && !match[2] && value < MIN_PLAUSIBLE_AMOUNT) continue;
    out.push({ value, index: match.index, raw });
  }
  return out;
}

export function parseOfferText(rawText: string): ParseResult {
  const text = rawText.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const lines = text.split("\n");

  const hasAnnual = PERIOD_ANNUAL.test(text);
  const hasMonthly = PERIOD_MONTHLY.test(text);
  const documentPeriod: ParseResult["period"] =
    hasAnnual && hasMonthly ? "mixed" : hasAnnual ? "annual" : hasMonthly ? "monthly" : "unknown";

  const components: ParsedComponent[] = [];
  const unmatched: { label: string; annual: number }[] = [];
  const seen = new Set<ComponentKey>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 3 || trimmed.length > 300) continue;

    const numbers = numbersIn(trimmed);
    if (numbers.length === 0) continue;

    const firstNumber = numbers[0];
    if (!firstNumber) continue;
    const label = trimmed.slice(0, firstNumber.index).replace(/[|:.\t–—-]+$/g, "").trim();
    if (label.length < 2 || label.length > 80) continue;
    // A label that is mostly digits is a table row of figures, not a component.
    if ((label.match(/\d/g)?.length ?? 0) > label.length / 2) continue;

    // Two numbers whose ratio is ~12 is the classic (monthly, annual) pair.
    let annual: number;
    let fromMonthly = false;
    const candidates = numbers.slice(0, 3).map((n) => n.value);
    const first = candidates[0] ?? 0;
    const second = candidates[1] ?? 0;
    const paired = candidates.length >= 2;

    if (paired && first > 0 && Math.abs(second / first - 12) < 0.6) {
      annual = second;
    } else if (paired && second > 0 && Math.abs(first / second - 12) < 0.6) {
      annual = first;
    } else {
      const value = Math.max(...candidates);
      const linePeriod = PERIOD_MONTHLY.test(trimmed)
        ? "monthly"
        : PERIOD_ANNUAL.test(trimmed)
          ? "annual"
          : documentPeriod;
      if (linePeriod === "monthly") {
        annual = value * 12;
        fromMonthly = true;
      } else {
        annual = value;
      }
    }

    const key = classify(label);
    if (!key) {
      unmatched.push({ label, annual });
      continue;
    }
    // First occurrence wins: breakups often repeat a component in a summary row.
    if (seen.has(key)) continue;
    seen.add(key);
    components.push({ key, label, annual, fromMonthly });
  }

  return { components, unmatched, period: documentPeriod, text };
}

/** Look up a parsed component's annual value. */
export function componentValue(parsed: ParseResult, key: ComponentKey): number {
  return parsed.components.find((c) => c.key === key)?.annual ?? 0;
}
