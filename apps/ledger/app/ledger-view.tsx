"use client";

import { useState } from "react";
import { formatInr } from "@probes/core/money.ts";
import {
  AssumptionsPanel,
  DataTable,
  Note,
  Pill,
  ResultSection,
  StatGrid,
  UploadWidget,
} from "@probes/ui";
import type { LedgerResult } from "../lib/ledger.ts";

const SAMPLE = `Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance
01/04/2026,SALARY CREDIT ACME TECHNOLOGIES,NEFT0012,,185000.00,412300.50
02/04/2026,UPI-SWIGGY-swiggy@ybl,UPI40912,486.00,,411814.50
03/04/2026,UPI-AWS AMAZON WEB SERV,UPI40988,7412.00,,404402.50
05/04/2026,NEFT-RENT APRIL-LANDLORD,NEFT0031,38000.00,,366402.50`;

/** Rows shown before the "show everything" toggle. Keeps mobile usable. */
const PREVIEW_ROWS = 40;

export function LedgerView() {
  const [result, setResult] = useState<LedgerResult | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  function handleResult(payload: unknown) {
    const typed = payload as { id?: string; result?: LedgerResult };
    if (typed.result) {
      setResult(typed.result);
      setArtifactId(typed.id ?? null);
      setShowAll(false);
      requestAnimationFrame(() =>
        document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  }

  return (
    <div>
      <UploadWidget
        action="/api/ledger"
        accept=".csv,.txt"
        ctaLabel="Build my ledger"
        pasteLabel="Or paste the CSV, header row included"
        pastePlaceholder={SAMPLE}
        onResult={handleResult}
        helpText="Export the CSV your bank or UPI app already offers. We read the column names, not their positions, so the order doesn't matter."
      />

      {result ? (
        <Result
          result={result}
          artifactId={artifactId}
          showAll={showAll}
          onShowAll={() => setShowAll(true)}
          filter={filter}
          onFilter={setFilter}
        />
      ) : null}
    </div>
  );
}

function Result({
  result,
  artifactId,
  showAll,
  onShowAll,
  filter,
  onFilter,
}: {
  result: LedgerResult;
  artifactId: string | null;
  showAll: boolean;
  onShowAll: () => void;
  filter: string;
  onFilter: (value: string) => void;
}) {
  const filtered =
    filter === "all" ? result.entries : result.entries.filter((e) => e.category === filter);
  const visible = showAll ? filtered : filtered.slice(0, PREVIEW_ROWS);

  return (
    <div id="result" className="mt-10 scroll-mt-6">
      <StatGrid
        items={[
          { label: "Money in", value: formatInr(result.totals.moneyIn), tone: "good", hint: `${result.period.months} month${result.period.months === 1 ? "" : "s"}` },
          { label: "Money out", value: formatInr(result.totals.moneyOut), tone: "bad" },
          {
            label: "Net",
            value: formatInr(result.totals.net),
            tone: result.totals.net >= 0 ? "good" : "bad",
          },
          {
            label: "Transactions",
            value: String(result.totals.count),
            hint: `${result.period.from} to ${result.period.to}`,
          },
        ]}
      />

      {result.parse.skipped.length > 0 ? (
        <div className="mt-4">
          <Note>
            We skipped {result.parse.skipped.length} row
            {result.parse.skipped.length === 1 ? "" : "s"} we could not read — usually statement
            headers and footers. Rows{" "}
            {result.parse.skipped.slice(0, 8).map((s) => s.row).join(", ")}
            {result.parse.skipped.length > 8 ? " and others" : ""}. They are in no total above.
          </Note>
        </div>
      ) : null}

      {result.uncategorisedCount > 0 ? (
        <div className="mt-3">
          <Note>
            {result.uncategorisedCount} payment
            {result.uncategorisedCount === 1 ? "" : "s"} worth{" "}
            {formatInr(result.uncategorisedValue)} matched no rule. They are counted in the totals
            but sit in &ldquo;Not categorised&rdquo; — filter to them below and check for transfers
            between your own accounts, which are the usual culprit.
          </Note>
        </div>
      ) : null}

      <ResultSection title="Month by month">
        <DataTable
          columns={["Month", "Money in", "Money out", "Net", "Transactions"]}
          align={["left", "right", "right", "right", "right"]}
          rows={result.byMonth.map((month) => [
            month.label,
            formatInr(month.moneyIn),
            formatInr(month.moneyOut),
            <span key="n" className={month.net >= 0 ? "text-emerald-700" : "text-rose-700"}>
              {formatInr(month.net)}
            </span>,
            String(month.count),
          ])}
        />
      </ResultSection>

      <ResultSection title="Where it went">
        <DataTable
          columns={["Category", "Total", "Count", "Share", "Notes"]}
          align={["left", "right", "right", "right", "left"]}
          rows={result.byCategory.map((row) => [
            row.label,
            formatInr(row.total),
            String(row.count),
            `${row.sharePct}%`,
            <span key="t" className="flex flex-wrap gap-1">
              {row.commonlyCarriesGst ? <Pill tone="neutral">often has GST</Pill> : null}
              {row.businessLikely ? <Pill tone="neutral">likely business</Pill> : null}
            </span>,
          ])}
        />
      </ResultSection>

      <ResultSection
        title="GST review shortlist"
        description="Payments in categories that commonly carry GST. Use it to work out which invoices to chase."
      >
        <DataTable
          columns={["Category", "Paid", "Payments"]}
          align={["left", "right", "right"]}
          rows={result.gst.byCategory.map((row) => [
            row.label,
            formatInr(row.total),
            String(row.count),
          ])}
        />
        <p className="mt-4 text-sm font-semibold">
          {formatInr(result.gst.reviewableSpend)} across {result.gst.reviewableCount} payments to
          review.
        </p>
        <ul className="mt-3 space-y-2 text-[13px] leading-relaxed text-[var(--muted)]">
          {result.gst.caveats.map((caveat) => (
            <li key={caveat}>• {caveat}</li>
          ))}
        </ul>
      </ResultSection>

      <ResultSection
        title="Every transaction"
        description="The 'Matched on' column is the keyword that produced the category. If it looks wrong, it is wrong — and now you can see exactly why."
        actions={
          <select
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
            aria-label="Filter by category"
            className="rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
          >
            <option value="all">All categories</option>
            {result.byCategory.map((row) => (
              <option key={row.category} value={row.category}>
                {row.label} ({row.count})
              </option>
            ))}
          </select>
        }
      >
        <DataTable
          columns={["Date", "Description", "Category", "Matched on", "Amount"]}
          align={["left", "left", "left", "left", "right"]}
          rows={visible.map((entry) => [
            entry.date,
            <span key="d" className="block max-w-[22rem] truncate" title={entry.narration}>
              {entry.narration}
            </span>,
            entry.categoryLabel,
            <span key="m" className="font-mono text-[12px] text-[var(--muted)]">
              {entry.matchedOn ?? "—"}
            </span>,
            <span key="a" className={entry.amountMinor >= 0 ? "text-emerald-700" : ""}>
              {formatInr(entry.amountMinor)}
            </span>,
          ])}
        />
        {!showAll && filtered.length > PREVIEW_ROWS ? (
          <button
            type="button"
            onClick={onShowAll}
            className="mt-4 rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-medium"
          >
            Show all {filtered.length} rows
          </button>
        ) : null}
      </ResultSection>

      <AssumptionsPanel items={result.assumptions} />

      {artifactId ? (
        <div className="mt-6">
          <a
            href={`/api/export?id=${encodeURIComponent(artifactId)}`}
            className="inline-flex rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white"
          >
            Download the Excel file
          </a>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Four sheets: the full ledger, month by month, by category, and a GST review list with
            blank columns for the invoice figures only you can fill in.
          </p>
        </div>
      ) : null}
    </div>
  );
}
