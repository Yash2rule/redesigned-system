"use client";

import { useEffect, useState } from "react";
import { formatInr } from "@probes/core/money.ts";
import { DataTable, Note, Pill, ResultSection, StatGrid } from "@probes/ui";
import { forgetStatements, readSavedStatements, type SavedStatement } from "../../lib/saved.ts";
import { readOverrides } from "../../lib/overrides.ts";
import type { RollupResult, FinancialYear } from "../../lib/rollup.ts";

export function RollupView() {
  const [saved, setSaved] = useState<SavedStatement[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [year, setYear] = useState<string>("");
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [rollup, setRollup] = useState<RollupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const statements = readSavedStatements();
    setSaved(statements);
    setSelected(statements.map((s) => s.id));
  }, []);

  async function build(chosenYear?: string) {
    if (selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/rollup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: selected,
          year: chosenYear ?? (year || undefined),
          overrides: readOverrides(),
        }),
      });
      const payload = (await response.json()) as {
        rollup?: RollupResult;
        availableYears?: FinancialYear[];
        error?: string;
      };
      if (!response.ok || payload.error || !payload.rollup) {
        setError(payload.error ?? `Something went wrong (${response.status}).`);
        return;
      }
      setRollup(payload.rollup);
      setYears(payload.availableYears ?? []);
      setYear(payload.rollup.financialYear.label);
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const response = await fetch("/api/rollup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selected, year, overrides: readOverrides(), format: "xlsx" }),
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `financial-year-${year}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (saved === null) {
    return <p className="text-sm text-[var(--muted)]">Looking for statements saved in this browser…</p>;
  }

  if (saved.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-sm font-medium">No statements saved in this browser yet.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Process a statement and it appears here. The list of which ledgers are yours lives in this
          browser only, so it will not follow you to another device.
        </p>
        <a
          href="/"
          className="mt-4 inline-flex text-sm font-semibold text-[var(--accent)] underline underline-offset-4"
        >
          Build your first ledger
        </a>
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {saved.length} statement{saved.length === 1 ? "" : "s"} in this browser
          </p>
          <button
            type="button"
            onClick={() => {
              forgetStatements();
              setSaved([]);
              setSelected([]);
              setRollup(null);
            }}
            className="text-[13px] text-[var(--muted)] underline underline-offset-2"
          >
            Forget them all
          </button>
        </div>

        <ul className="mt-4 space-y-2">
          {saved.map((statement) => {
            const checked = selected.includes(statement.id);
            return (
              <li key={statement.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm ${
                    checked ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) =>
                        prev.includes(statement.id)
                          ? prev.filter((id) => id !== statement.id)
                          : [...prev, statement.id],
                      )
                    }
                    className="h-4 w-4"
                  />
                  <span className="flex-1">
                    <span className="font-medium">{statement.label}</span>
                    <span className="ml-2 text-[var(--muted)]">
                      {statement.from} to {statement.to}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={busy || selected.length === 0}
          onClick={() => void build()}
          className="mt-4 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
        >
          {busy ? "Combining…" : `Combine ${selected.length} statement${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>

      {rollup ? (
        <div className="mt-8">
          {years.length > 1 ? (
            <label className="mb-4 block text-sm">
              <span className="mb-1.5 block font-medium">Financial year</span>
              <select
                value={year}
                onChange={(e) => {
                  setYear(e.target.value);
                  void build(e.target.value);
                }}
                className="rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
              >
                {years.map((fy) => (
                  <option key={fy.label} value={fy.label}>
                    FY {fy.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <StatGrid
            items={[
              { label: `FY ${rollup.financialYear.label} in`, value: formatInr(rollup.totals.moneyIn), tone: "good" },
              { label: "Out", value: formatInr(rollup.totals.moneyOut), tone: "bad" },
              {
                label: "Net",
                value: formatInr(rollup.totals.net),
                tone: rollup.totals.net >= 0 ? "good" : "bad",
              },
              { label: "Transactions", value: String(rollup.totals.count) },
            ]}
          />

          {rollup.duplicatesRemoved > 0 || rollup.missingMonths.length > 0 ? (
            <div className="mt-4 space-y-2">
              {rollup.notes.slice(1).map((note) => (
                <Note key={note}>{note}</Note>
              ))}
            </div>
          ) : null}

          <ResultSection title="Month by month">
            <DataTable
              columns={["Month", "In", "Out", "Net", "Rows"]}
              align={["left", "right", "right", "right", "right"]}
              rows={rollup.byMonth.map((month) => [
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

          <ResultSection title="Where the year went">
            <DataTable
              columns={["Category", "Total", "Rows", "Share", "Notes"]}
              align={["left", "right", "right", "right", "left"]}
              rows={rollup.byCategory.map((row) => [
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
            title="Which statements went in"
            description="Duplicates are transactions that appeared in more than one export. Counting them twice would overstate your income."
          >
            <DataTable
              columns={["Statement", "Counted", "Duplicates skipped", "Outside the year"]}
              align={["left", "right", "right", "right"]}
              rows={rollup.sources.map((source) => [
                source.label,
                String(source.kept),
                String(source.duplicates),
                String(source.outOfYear),
              ])}
            />
          </ResultSection>

          <ResultSection title="What this does and does not include">
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {rollup.notes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          </ResultSection>

          <button
            type="button"
            onClick={() => void download()}
            className="mt-6 inline-flex rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white"
          >
            Download the year as Excel
          </button>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Four sheets: every transaction in the year, month by month, by category, and which
            statements contributed what. This is the file to send a CA.
          </p>
        </div>
      ) : null}
    </div>
  );
}
