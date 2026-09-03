import { renderWorkbook } from "@probes/core/server";
import { config } from "./config.ts";
import type { LedgerResult } from "./ledger.ts";

const rupees = (minor: number) => Number((minor / 100).toFixed(2));
const INR = '₹#,##0.00';

/** Four sheets: the ledger itself, monthly totals, categories, and the GST shortlist. */
export async function buildLedgerWorkbook(result: LedgerResult): Promise<Buffer> {
  return renderWorkbook({
    creator: config.name,
    sheets: [
      {
        name: "Ledger",
        notes: [
          `${result.totals.count} transactions from ${result.period.from} to ${result.period.to}.`,
          "Money out is negative. The 'Matched on' column shows the keyword that produced each category.",
          config.disclaimer,
        ],
        columns: [
          { header: "Date", key: "date", width: 12 },
          { header: "Description", key: "narration", width: 52 },
          { header: "Category", key: "categoryLabel", width: 24 },
          { header: "Matched on", key: "matchedOn", width: 18 },
          { header: "Amount", key: "amount", width: 15, numFmt: INR },
          { header: "Balance", key: "balance", width: 15, numFmt: INR },
          { header: "Reference", key: "reference", width: 22 },
        ],
        rows: result.entries.map((entry) => ({
          date: entry.date,
          narration: entry.narration,
          categoryLabel: entry.categoryLabel,
          matchedOn: entry.matchedOn ?? "—",
          amount: rupees(entry.amountMinor),
          balance: entry.balanceMinor === null ? null : rupees(entry.balanceMinor),
          reference: entry.reference,
        })),
      },
      {
        name: "By month",
        columns: [
          { header: "Month", key: "label", width: 18 },
          { header: "Money in", key: "moneyIn", width: 16, numFmt: INR },
          { header: "Money out", key: "moneyOut", width: 16, numFmt: INR },
          { header: "Net", key: "net", width: 16, numFmt: INR },
          { header: "Transactions", key: "count", width: 14 },
        ],
        rows: result.byMonth.map((month) => ({
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
          { header: "Share of all activity", key: "sharePct", width: 20 },
          { header: "Commonly carries GST", key: "gst", width: 22 },
          { header: "Likely business", key: "business", width: 18 },
        ],
        rows: result.byCategory.map((row) => ({
          label: row.label,
          total: rupees(row.total),
          count: row.count,
          sharePct: `${row.sharePct}%`,
          gst: row.commonlyCarriesGst ? "yes" : "no",
          business: row.businessLikely ? "yes" : "no",
        })),
      },
      {
        name: "GST review list",
        notes: result.gst.caveats,
        columns: [
          { header: "Date", key: "date", width: 12 },
          { header: "Description", key: "narration", width: 52 },
          { header: "Category", key: "categoryLabel", width: 24 },
          { header: "Amount paid", key: "amount", width: 16, numFmt: INR },
          { header: "Invoice collected?", key: "invoice", width: 20 },
          { header: "GST in invoice", key: "gstAmount", width: 18, numFmt: INR },
        ],
        rows: result.entries
          .filter((entry) => entry.amountMinor < 0 && entry.category !== "uncategorised")
          .filter((entry) =>
            result.gst.byCategory.some((category) => category.category === entry.category),
          )
          .map((entry) => ({
            date: entry.date,
            narration: entry.narration,
            categoryLabel: entry.categoryLabel,
            amount: rupees(Math.abs(entry.amountMinor)),
            // Left blank on purpose: these are for the user to fill from the
            // actual invoices. We cannot know them from a bank statement.
            invoice: "",
            gstAmount: null,
          })),
      },
    ],
  });
}
