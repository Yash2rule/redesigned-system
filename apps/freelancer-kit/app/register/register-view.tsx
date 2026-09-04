"use client";

import { useEffect, useState } from "react";
import { formatInr } from "@probes/core/money.ts";
import { DataTable, Note, ResultSection, StatGrid } from "@probes/ui";
import { readProfile, type SavedInvoice } from "../../lib/profile.ts";
import { turnoverNote, type FinancialYear, type RegisterResult } from "../../lib/register.ts";

export function RegisterView() {
  const [saved, setSaved] = useState<SavedInvoice[] | null>(null);
  const [register, setRegister] = useState<RegisterResult | null>(null);
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [registered, setRegistered] = useState(false);
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSaved(readProfile().invoices);
  }, []);

  async function build(chosen?: string) {
    const ids = (saved ?? []).map((invoice) => invoice.id);
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, year: chosen ?? (year || undefined) }),
      });
      const payload = (await response.json()) as {
        register?: RegisterResult;
        availableYears?: FinancialYear[];
        registered?: boolean;
        error?: string;
      };
      if (!response.ok || payload.error || !payload.register) {
        setError(payload.error ?? `Something went wrong (${response.status}).`);
        return;
      }
      setRegister(payload.register);
      setYears(payload.availableYears ?? []);
      setRegistered(payload.registered ?? false);
      setYear(payload.register.financialYear.label);
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: (saved ?? []).map((i) => i.id), year, format: "xlsx" }),
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `invoice-register-${year}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (saved === null) {
    return <p className="text-sm text-[var(--muted)]">Looking for invoices raised in this browser…</p>;
  }

  if (saved.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-sm font-medium">No invoices raised in this browser yet.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Make an invoice and it appears here. Only invoices generated on this device are
          included — anything you raised elsewhere will not be in the register.
        </p>
        <a href="/" className="mt-4 inline-flex text-sm font-semibold text-[var(--accent)] underline underline-offset-4">
          Make your first invoice
        </a>
      </div>
    );
  }

  const turnover = register ? turnoverNote(register.totals.taxableMinor, registered) : null;

  return (
    <div>
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5">
        <p className="text-sm font-medium">
          {saved.length} invoice{saved.length === 1 ? "" : "s"} raised in this browser
        </p>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          Newest: {saved[0]?.number} to {saved[0]?.clientName} on {saved[0]?.date}
        </p>
        {error ? (
          <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void build()}
          className="mt-4 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
        >
          {busy ? "Building…" : "Build the register"}
        </button>
      </div>

      {register ? (
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
              { label: `FY ${register.financialYear.label} invoiced`, value: formatInr(register.totals.totalMinor) },
              { label: "Taxable value", value: formatInr(register.totals.taxableMinor) },
              {
                label: "Tax charged",
                value: formatInr(
                  register.totals.cgstMinor + register.totals.sgstMinor + register.totals.igstMinor,
                ),
              },
              { label: "Invoices", value: String(register.totals.invoices) },
            ]}
          />

          {register.duplicateNumbers.length > 0 ? (
            <div className="mt-4">
              <Note>
                <strong>
                  Invoice number{register.duplicateNumbers.length === 1 ? "" : "s"}{" "}
                  {register.duplicateNumbers.join(", ")} appear more than once.
                </strong>{" "}
                An invoice series has to be consecutive and unique. Fix this before anything is
                filed.
              </Note>
            </div>
          ) : null}

          {turnover ? (
            <div className="mt-3">
              <Note>{turnover}</Note>
            </div>
          ) : null}

          <ResultSection title="Year-end summary">
            <DataTable
              columns={["", "Amount"]}
              align={["left", "right"]}
              rows={[
                ["Taxable value", formatInr(register.totals.taxableMinor)],
                ["CGST charged", formatInr(register.totals.cgstMinor)],
                ["SGST charged", formatInr(register.totals.sgstMinor)],
                ["IGST charged", formatInr(register.totals.igstMinor)],
                [<strong key="l">Invoiced in total</strong>, <strong key="v">{formatInr(register.totals.totalMinor)}</strong>],
              ]}
            />
          </ResultSection>

          <ResultSection title="The register">
            <DataTable
              columns={["Invoice", "Date", "Client", "Taxable", "Tax", "Total"]}
              align={["left", "left", "left", "right", "right", "right"]}
              rows={register.lines.map((line) => [
                line.invoiceNumber,
                line.invoiceDate,
                <span key="c" className="block max-w-[14rem] truncate" title={line.clientName}>
                  {line.clientName}
                </span>,
                formatInr(line.taxableMinor),
                formatInr(line.cgstMinor + line.sgstMinor + line.igstMinor),
                formatInr(line.totalMinor),
              ])}
            />
          </ResultSection>

          <ResultSection title="By client">
            <DataTable
              columns={["Client", "GSTIN", "Invoices", "Invoiced"]}
              align={["left", "left", "right", "right"]}
              rows={register.byClient.map((client) => [
                client.name,
                client.gstin || "unregistered",
                String(client.invoices),
                formatInr(client.totalMinor),
              ])}
            />
          </ResultSection>

          <ResultSection title="What this is, and is not">
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {register.notes.map((note) => (
                <li key={note}>• {note}</li>
              ))}
            </ul>
          </ResultSection>

          <button
            type="button"
            onClick={() => void download()}
            className="mt-6 inline-flex rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white"
          >
            Download the register as Excel
          </button>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Four sheets: the register, a year-end summary, by month and by client.
          </p>
        </div>
      ) : null}
    </div>
  );
}
