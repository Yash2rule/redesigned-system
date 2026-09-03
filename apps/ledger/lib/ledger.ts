import { CATEGORIES, categorise } from "./categorise.ts";
import type { CategoryId } from "./categorise.ts";
import { parseStatement } from "./statement.ts";
import type { StatementParse, Txn } from "./statement.ts";

/**
 * Build the ledger, the monthly totals and the GST-ready summary from a parsed
 * statement.
 *
 * The GST section is framed carefully and deliberately: a bank statement shows
 * a payment, never a tax component, and input tax credit depends on holding a
 * valid invoice and on the supplier having filed. So this produces a shortlist
 * of payments worth checking invoices for, and says so in those words. It does
 * not compute a claimable figure, because no honest tool could from this input.
 */

export type LedgerEntry = Txn & {
  category: CategoryId;
  categoryLabel: string;
  matchedOn: string | null;
  basis: "rule" | "direction" | "none";
};

export type MonthTotals = {
  /** yyyy-mm */
  month: string;
  label: string;
  moneyIn: number;
  moneyOut: number;
  net: number;
  count: number;
};

export type CategoryTotals = {
  category: CategoryId;
  label: string;
  total: number;
  count: number;
  sharePct: number;
  commonlyCarriesGst: boolean;
  businessLikely: boolean;
};

export type GstSummary = {
  /** Payments in categories that commonly carry GST. Not a claimable figure. */
  reviewableSpend: number;
  reviewableCount: number;
  byCategory: { category: CategoryId; label: string; total: number; count: number }[];
  caveats: string[];
};

export type LedgerResult = {
  entries: LedgerEntry[];
  parse: Omit<StatementParse, "transactions">;
  period: { from: string; to: string; months: number };
  totals: { moneyIn: number; moneyOut: number; net: number; count: number };
  byMonth: MonthTotals[];
  byCategory: CategoryTotals[];
  gst: GstSummary;
  uncategorisedCount: number;
  uncategorisedValue: number;
  assumptions: string[];
};

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  const index = Number(m) - 1;
  return `${MONTH_LABELS[index] ?? m} ${year}`;
}

export function buildLedger(rows: string[][]): LedgerResult {
  const parsed = parseStatement(rows);

  const entries: LedgerEntry[] = parsed.transactions.map((txn) => {
    const result = categorise(txn.narration, txn.amountMinor);
    return {
      ...txn,
      category: result.category,
      categoryLabel: CATEGORIES[result.category].label,
      matchedOn: result.matchedOn,
      basis: result.basis,
    };
  });

  const moneyIn = entries.filter((e) => e.amountMinor > 0).reduce((s, e) => s + e.amountMinor, 0);
  const moneyOut = entries.filter((e) => e.amountMinor < 0).reduce((s, e) => s + Math.abs(e.amountMinor), 0);

  // --- monthly -------------------------------------------------------------
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

  // --- by category ---------------------------------------------------------
  const categoryMap = new Map<CategoryId, { total: number; count: number }>();
  for (const entry of entries) {
    const existing = categoryMap.get(entry.category) ?? { total: 0, count: 0 };
    existing.total += Math.abs(entry.amountMinor);
    existing.count += 1;
    categoryMap.set(entry.category, existing);
  }
  const grandTotal = moneyIn + moneyOut;
  const byCategory: CategoryTotals[] = [...categoryMap.entries()]
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

  // --- GST shortlist -------------------------------------------------------
  const gstCandidates = entries.filter(
    (e) => e.amountMinor < 0 && CATEGORIES[e.category].commonlyCarriesGst,
  );
  const gstByCategory = new Map<CategoryId, { total: number; count: number }>();
  for (const entry of gstCandidates) {
    const existing = gstByCategory.get(entry.category) ?? { total: 0, count: 0 };
    existing.total += Math.abs(entry.amountMinor);
    existing.count += 1;
    gstByCategory.set(entry.category, existing);
  }

  const gst: GstSummary = {
    reviewableSpend: gstCandidates.reduce((s, e) => s + Math.abs(e.amountMinor), 0),
    reviewableCount: gstCandidates.length,
    byCategory: [...gstByCategory.entries()]
      .map(([category, value]) => ({
        category,
        label: CATEGORIES[category].label,
        total: value.total,
        count: value.count,
      }))
      .sort((a, b) => b.total - a.total),
    caveats: [
      "These are payments in categories that commonly carry GST. This is a shortlist to check invoices against — it is not an input tax credit figure, and we have not computed one.",
      "A bank statement shows the amount paid, never the tax inside it. The only source for the GST component is the supplier's invoice.",
      "Input tax credit also depends on the supplier having filed their return and on the expense being for business use. Neither is visible here.",
      "Personal spending is excluded from this list, but the split between personal and business is our guess from the merchant name. Check it.",
    ],
  };

  const uncategorised = entries.filter((e) => e.category === "uncategorised");
  const from = entries[0]?.date ?? "";
  const to = entries[entries.length - 1]?.date ?? "";

  const assumptions: string[] = [
    parsed.dateFormat === "day-first"
      ? "Dates were read day-first (dd/mm/yyyy), the Indian convention. If your export uses month-first, every date here is wrong — tell us and we'll add a switch."
      : `Dates were read as ${parsed.dateFormat === "iso" ? "ISO (yyyy-mm-dd)" : "day and month name"}, which is unambiguous.`,
    `We used the column "${parsed.columnLabels.date}" for the date and "${parsed.columnLabels.narration || "(none found)"}" for the description.`,
    parsed.columnLabels.debit || parsed.columnLabels.credit
      ? `Money out came from "${parsed.columnLabels.debit || "(none)"}" and money in from "${parsed.columnLabels.credit || "(none)"}".`
      : `Amounts came from a single column, "${parsed.columnLabels.amount}", using its sign${parsed.columns.type !== null ? " and the transaction type column" : ""}.`,
    "Categories come from keyword rules on the description. Every row shows which keyword matched, so you can see where we guessed wrong.",
    "Transfers between your own accounts are only detected when the description says so. If you move money between accounts often, some of it will be counted as income and as spending.",
  ];

  return {
    entries,
    parse: {
      columns: parsed.columns,
      columnLabels: parsed.columnLabels,
      headerRowIndex: parsed.headerRowIndex,
      skipped: parsed.skipped,
      dateFormat: parsed.dateFormat,
    },
    period: { from, to, months: byMonth.length },
    totals: { moneyIn, moneyOut, net: moneyIn - moneyOut, count: entries.length },
    byMonth,
    byCategory,
    gst,
    uncategorisedCount: uncategorised.length,
    uncategorisedValue: uncategorised.reduce((s, e) => s + Math.abs(e.amountMinor), 0),
    assumptions,
  };
}
