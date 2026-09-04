import { CATEGORIES } from "./categorise.ts";
import type { CategoryId } from "./categorise.ts";
import type { LedgerEntry, LedgerResult, MonthTotals } from "./ledger.ts";

/**
 * Combine several statements into one financial year.
 *
 * The thing a CA actually asks for in March is not one statement — it is the
 * whole year, across however many accounts and exports it took. Two problems
 * have to be solved honestly for that to be worth anything:
 *
 * 1. Statements overlap. Someone downloads Apr-Jun and then Apr-Dec, and the
 *    same transaction appears twice. Double-counted income is worse than no
 *    rollup at all, so duplicates are detected and reported.
 * 2. A financial year in India runs 1 April to 31 March, not January to
 *    December. Filing against the wrong twelve months is not a rounding error.
 */

export type FinancialYear = {
  /** e.g. "2025-26" */
  label: string;
  startIso: string;
  endIso: string;
};

/** The Indian financial year containing a given date. */
export function financialYearOf(iso: string): FinancialYear {
  const date = new Date(`${iso}T00:00:00Z`);
  const year = date.getUTCFullYear();
  // January to March belong to the FY that started the previous April.
  const startYear = date.getUTCMonth() >= 3 ? year : year - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    startIso: `${startYear}-04-01`,
    endIso: `${startYear + 1}-03-31`,
  };
}

export function financialYearsIn(entries: { date: string }[]): FinancialYear[] {
  const seen = new Map<string, FinancialYear>();
  for (const entry of entries) {
    const fy = financialYearOf(entry.date);
    seen.set(fy.label, fy);
  }
  return [...seen.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
}

/**
 * Identity of a transaction, for de-duplication across overlapping exports.
 *
 * Date, amount and a normalised description. Reference numbers are excluded on
 * purpose: the same transaction can carry a different reference in two exports
 * from the same bank, and matching on it would let duplicates through.
 */
export function transactionKey(entry: LedgerEntry): string {
  const narration = entry.narration.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
  return `${entry.date}|${entry.amountMinor}|${narration}`;
}

export type RollupResult = {
  financialYear: FinancialYear;
  /** How many statements went in, and how many rows each contributed. */
  sources: { id: string; label: string; kept: number; duplicates: number; outOfYear: number }[];
  entries: LedgerEntry[];
  totals: { moneyIn: number; moneyOut: number; net: number; count: number };
  byMonth: MonthTotals[];
  byCategory: {
    category: CategoryId;
    label: string;
    total: number;
    count: number;
    sharePct: number;
    commonlyCarriesGst: boolean;
    businessLikely: boolean;
  }[];
  gstReviewableSpend: number;
  gstReviewableCount: number;
  duplicatesRemoved: number;
  outOfYearRemoved: number;
  /** Months in the year with no transactions at all — usually a missing export. */
  missingMonths: string[];
  notes: string[];
};

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTH_LABELS[Number(m) - 1] ?? m} ${year}`;
}

/** Every yyyy-mm in a financial year, in order. */
export function monthsInYear(fy: FinancialYear): string[] {
  const months: string[] = [];
  const start = new Date(`${fy.startIso}T00:00:00Z`);
  for (let i = 0; i < 12; i += 1) {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function buildRollup(
  sources: { id: string; label: string; result: LedgerResult }[],
  fy: FinancialYear,
): RollupResult {
  const seen = new Set<string>();
  const entries: LedgerEntry[] = [];
  const sourceStats: RollupResult["sources"] = [];
  let duplicatesRemoved = 0;
  let outOfYearRemoved = 0;

  for (const source of sources) {
    let kept = 0;
    let duplicates = 0;
    let outOfYear = 0;

    for (const entry of source.result.entries) {
      if (entry.date < fy.startIso || entry.date > fy.endIso) {
        outOfYear += 1;
        outOfYearRemoved += 1;
        continue;
      }
      const key = transactionKey(entry);
      if (seen.has(key)) {
        duplicates += 1;
        duplicatesRemoved += 1;
        continue;
      }
      seen.add(key);
      entries.push(entry);
      kept += 1;
    }
    sourceStats.push({ id: source.id, label: source.label, kept, duplicates, outOfYear });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));

  const moneyIn = entries.filter((e) => e.amountMinor > 0).reduce((s, e) => s + e.amountMinor, 0);
  const moneyOut = entries
    .filter((e) => e.amountMinor < 0)
    .reduce((s, e) => s + Math.abs(e.amountMinor), 0);

  const monthMap = new Map<string, MonthTotals>();
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    const existing = monthMap.get(month) ?? {
      month,
      label: monthLabel(month),
      moneyIn: 0,
      moneyOut: 0,
      net: 0,
      count: 0,
    };
    if (entry.amountMinor > 0) existing.moneyIn += entry.amountMinor;
    else existing.moneyOut += Math.abs(entry.amountMinor);
    existing.net = existing.moneyIn - existing.moneyOut;
    existing.count += 1;
    monthMap.set(month, existing);
  }
  const byMonth = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));

  const categoryMap = new Map<CategoryId, { total: number; count: number }>();
  for (const entry of entries) {
    const existing = categoryMap.get(entry.category) ?? { total: 0, count: 0 };
    existing.total += Math.abs(entry.amountMinor);
    existing.count += 1;
    categoryMap.set(entry.category, existing);
  }
  const grandTotal = moneyIn + moneyOut;
  const byCategory = [...categoryMap.entries()]
    .map(([category, value]) => ({
      category,
      label: CATEGORIES[category].label,
      total: value.total,
      count: value.count,
      sharePct: grandTotal > 0 ? Number(((value.total / grandTotal) * 100).toFixed(1)) : 0,
      commonlyCarriesGst: CATEGORIES[category].commonlyCarriesGst,
      businessLikely: CATEGORIES[category].businessLikely,
    }))
    .sort((a, b) => b.total - a.total);

  const gstCandidates = entries.filter(
    (e) => e.amountMinor < 0 && CATEGORIES[e.category].commonlyCarriesGst,
  );

  const present = new Set(byMonth.map((m) => m.month));
  const missingMonths = monthsInYear(fy)
    .filter((month) => !present.has(month))
    .map(monthLabel);

  const notes: string[] = [
    `Financial year ${fy.label}: 1 April ${fy.startIso.slice(0, 4)} to 31 March ${fy.endIso.slice(0, 4)}. Anything outside those dates was left out.`,
  ];
  if (duplicatesRemoved > 0) {
    notes.push(
      `${duplicatesRemoved} transactions appeared in more than one of your statements and were counted once. Overlapping exports are normal; double-counted income is not.`,
    );
  }
  if (missingMonths.length > 0) {
    notes.push(
      `${missingMonths.length} month${missingMonths.length === 1 ? "" : "s"} of the year have no transactions at all: ${missingMonths.join(", ")}. That usually means a statement is missing rather than a quiet month.`,
    );
  }
  notes.push(
    "This combines what you uploaded. If an account is missing, so is its income — we cannot know what we were not given.",
  );

  return {
    financialYear: fy,
    sources: sourceStats,
    entries,
    totals: { moneyIn, moneyOut, net: moneyIn - moneyOut, count: entries.length },
    byMonth,
    byCategory,
    gstReviewableSpend: gstCandidates.reduce((s, e) => s + Math.abs(e.amountMinor), 0),
    gstReviewableCount: gstCandidates.length,
    duplicatesRemoved,
    outOfYearRemoved,
    missingMonths,
    notes,
  };
}
