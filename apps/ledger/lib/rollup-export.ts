import { renderWorkbook } from "@probes/core/server";
import { config } from "./config.ts";
import type { RollupResult } from "./rollup.ts";

const rupees = (minor: number) => Number((minor / 100).toFixed(2));
const INR = '₹#,##0.00';

/** The year-end workbook a CA can actually work from. */
export async function buildRollupWorkbook(rollup: RollupResult): Promise<Buffer> {
  return renderWorkbook({
    creator: config.name,
    sheets: [
      {
        name: `FY ${rollup.financialYear.label}`,
        notes: [
          `Financial year ${rollup.financialYear.label} — 1 April ${rollup.financialYear.startIso.slice(0, 4)} to 31 March ${rollup.financialYear.endIso.slice(0, 4)}.`,
          `${rollup.totals.count} transactions from ${rollup.sources.length} statement(s). ${rollup.duplicatesRemoved} duplicates removed, ${rollup.outOfYearRemoved} outside the year.`,
          ...rollup.notes,
          config.disclaimer,
        ],
        columns: [
          { header: "Date", key: "date", width: 12 },
          { header: "Description", key: "narration", width: 52 },
          { header: "Category", key: "categoryLabel", width: 24 },
          { header: "Amount", key: "amount", width: 15, numFmt: INR },
        ],
        rows: rollup.entries.map((entry) => ({
          date: entry.date,
          narration: entry.narration,
          categoryLabel: entry.categoryLabel,
          amount: rupees(entry.amountMinor),
        })),
      },
      {
        name: "By month",
        notes: rollup.missingMonths.length
          ? [`No transactions at all in: ${rollup.missingMonths.join(", ")} — probably a missing statement.`]
          : [],
        columns: [
          { header: "Month", key: "label", width: 18 },
          { header: "Money in", key: "moneyIn", width: 16, numFmt: INR },
          { header: "Money out", key: "moneyOut", width: 16, numFmt: INR },
          { header: "Net", key: "net", width: 16, numFmt: INR },
          { header: "Transactions", key: "count", width: 14 },
        ],
        rows: rollup.byMonth.map((month) => ({
          label: month.label,
          moneyIn: rupees(month.moneyIn),
          moneyOut: rupees(month.moneyOut),
          net: rupees(month.net),
          count: month.count,
        })),
      },
      {
        name: "By category",
        columns: [
          { header: "Category", key: "label", width: 28 },
          { header: "Total", key: "total", width: 16, numFmt: INR },
          { header: "Transactions", key: "count", width: 14 },
          { header: "Share", key: "sharePct", width: 12 },
          { header: "Commonly carries GST", key: "gst", width: 22 },
          { header: "Likely business", key: "business", width: 18 },
        ],
        rows: rollup.byCategory.map((row) => ({
          label: row.label,
          total: rupees(row.total),
          count: row.count,
          sharePct: `${row.sharePct}%`,
          gst: row.commonlyCarriesGst ? "yes" : "no",
          business: row.businessLikely ? "yes" : "no",
        })),
      },
      {
        name: "Statements used",
        columns: [
          { header: "Statement", key: "label", width: 34 },
          { header: "Rows counted", key: "kept", width: 15 },
          { header: "Duplicates skipped", key: "duplicates", width: 20 },
          { header: "Outside the year", key: "outOfYear", width: 18 },
        ],
        rows: rollup.sources.map((source) => ({
          label: source.label,
          kept: source.kept,
          duplicates: source.duplicates,
          outOfYear: source.outOfYear,
        })),
      },
    ],
  });
}
