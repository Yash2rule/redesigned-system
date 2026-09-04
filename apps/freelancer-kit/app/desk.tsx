"use client";

import { useEffect, useState } from "react";
import { formatInr } from "@probes/core/money.ts";
import { DataTable, Note, Pill, ResultSection, StatGrid, trackClient } from "@probes/ui";
import type { InvoiceResult } from "../lib/invoice.ts";
import type { AdvanceTaxResult } from "../lib/advance-tax.ts";
import type { ContractResult } from "../lib/contract.ts";
import {
  forgetEverything,
  readProfile,
  saveClient,
  saveContractDefaults,
  saveLastInvoiceNumber,
  saveInvoice,
  saveSupplier,
  suggestNextInvoiceNumber,
  type SavedClient,
} from "../lib/profile.ts";

type Tab = "invoice" | "advance-tax" | "contract";

const TABS: { id: Tab; label: string; blurb: string }[] = [
  { id: "invoice", label: "GST invoice", blurb: "Correct CGST/SGST or IGST split, amount in words, and the declarations a tax invoice needs." },
  { id: "advance-tax", label: "Advance tax", blurb: "Your instalment schedule, with the 44ADA single-instalment rule applied when it applies." },
  { id: "contract", label: "Contract", blurb: "A twelve-clause services agreement in plain words." },
];

const field =
  "w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm";
const labelText = "mb-1.5 block text-sm font-medium";

export function Desk() {
  const [tab, setTab] = useState<Tab>("invoice");

  return (
    <div>
      <div role="tablist" aria-label="Tool" className="mb-6 flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
            className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === entry.id
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]"
                : "border-[var(--line)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="mb-5 text-sm text-[var(--muted)]">
        {TABS.find((t) => t.id === tab)?.blurb}
      </p>

      {tab === "invoice" ? <InvoiceForm /> : null}
      {tab === "advance-tax" ? <AdvanceTaxForm /> : null}
      {tab === "contract" ? <ContractForm /> : null}
    </div>
  );
}

function useTool<T>(endpoint: string, kind: string, onSaved?: (id: string, result: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<T | null>(null);
  const [id, setId] = useState<string | null>(null);

  async function run(body: unknown) {
    setBusy(true);
    setError(null);
    trackClient("upload_started", { kind });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { id?: string; result?: T; error?: string };
      if (!response.ok || payload.error || !payload.result) {
        setError(payload.error ?? `Something went wrong (${response.status}).`);
        return;
      }
      setResult(payload.result);
      setId(payload.id ?? null);
      if (payload.id) onSaved?.(payload.id, payload.result);
      trackClient("result_viewed", { kind });
      requestAnimationFrame(() =>
        document.getElementById("out")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (err) {
      setError(`Could not reach the server: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, result, id, run };
}

function Download({ id, label }: { id: string; label: string }) {
  return (
    <a
      href={`/api/document?id=${encodeURIComponent(id)}`}
      className="mt-6 inline-flex rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white"
    >
      {label}
    </a>
  );
}

function Errors({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
      {error}
    </p>
  );
}

// --- invoice ---------------------------------------------------------------

function InvoiceForm() {
  const tool = useTool<InvoiceResult>("/api/invoice", "invoice", (id, result) => {
    // Remember it so a financial-year register can be assembled later.
    saveInvoice({
      id,
      number: result.input.invoiceNumber,
      date: result.input.invoiceDate,
      clientName: result.input.client.name,
      totalMinor: result.totalMinor,
    });
    setInvoiceCount(readProfile().invoices.length);
  });
  const today = new Date().toISOString().slice(0, 10);
  const [clients, setClients] = useState<SavedClient[]>([]);
  const [remembered, setRemembered] = useState(false);
  const [invoiceCount, setInvoiceCount] = useState(0);

  const [form, setForm] = useState({
    supplierName: "",
    supplierAddress: "",
    supplierGstin: "",
    supplierEmail: "",
    supplierPan: "",
    clientName: "",
    clientAddress: "",
    clientGstin: "",
    clientCountry: "India",
    invoiceNumber: `INV-${new Date().getFullYear()}-001`,
    invoiceDate: today,
    dueDate: "",
    description: "",
    sacCode: "9983",
    quantity: "1",
    unitPrice: "",
    gstRatePct: "18",
    notes: "",
    lateFeePctPerMonth: "1.5",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  // localStorage is only readable after mount.
  useEffect(() => {
    const profile = readProfile();
    setClients(profile.clients);
    setRemembered(profile.supplier !== null);
    setInvoiceCount(profile.invoices.length);
    const nextNumber = suggestNextInvoiceNumber(profile.lastInvoiceNumber);
    setForm((prev) => ({
      ...prev,
      ...(profile.supplier
        ? {
            supplierName: profile.supplier.name,
            supplierAddress: profile.supplier.address,
            supplierGstin: profile.supplier.gstin,
            supplierEmail: profile.supplier.email,
            supplierPan: profile.supplier.pan,
          }
        : {}),
      ...(nextNumber ? { invoiceNumber: nextNumber } : {}),
    }));
  }, []);

  function applyClient(id: string) {
    const client = clients.find((entry) => entry.id === id);
    if (!client) return;
    setForm((prev) => ({
      ...prev,
      clientName: client.name,
      clientAddress: client.address,
      clientGstin: client.gstin,
      clientCountry: client.country || "India",
    }));
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // Remember the details worth not retyping. Stays in this browser.
          saveSupplier({
            name: form.supplierName,
            address: form.supplierAddress,
            gstin: form.supplierGstin,
            email: form.supplierEmail,
            phone: "",
            pan: form.supplierPan,
          });
          saveClient({
            name: form.clientName,
            address: form.clientAddress,
            gstin: form.clientGstin,
            country: form.clientCountry,
          });
          saveLastInvoiceNumber(form.invoiceNumber);
          setClients(readProfile().clients);
          setRemembered(true);

          void tool.run({
            supplier: {
              name: form.supplierName,
              address: form.supplierAddress,
              gstin: form.supplierGstin,
              email: form.supplierEmail,
              pan: form.supplierPan,
            },
            client: {
              name: form.clientName,
              address: form.clientAddress,
              gstin: form.clientGstin,
              country: form.clientCountry,
            },
            invoiceNumber: form.invoiceNumber,
            invoiceDate: form.invoiceDate,
            dueDate: form.dueDate,
            items: [
              {
                description: form.description,
                sacCode: form.sacCode,
                quantity: form.quantity,
                unitPrice: form.unitPrice,
              },
            ],
            gstRatePct: form.gstRatePct,
            notes: form.notes,
            lateFeePctPerMonth: form.lateFeePctPerMonth,
          });
        }}
        className="space-y-6 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6"
      >
        {clients.length > 0 ? (
          <label className="block text-sm">
            <span className={labelText}>Bill a client you have invoiced before</span>
            <select
              defaultValue=""
              onChange={(event) => {
                applyClient(event.target.value);
                event.target.value = "";
              }}
              className={field}
            >
              <option value="">Choose a saved client…</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                  {client.gstin ? ` — ${client.gstin}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">You</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className={labelText}>Your name or business name</span>
              <input required value={form.supplierName} onChange={set("supplierName")} className={field} /></label>
            <label><span className={labelText}>Your GSTIN (leave blank if not registered)</span>
              <input value={form.supplierGstin} onChange={set("supplierGstin")} placeholder="29ABCDE1234F1Z5" className={field} /></label>
            <label className="sm:col-span-2"><span className={labelText}>Your address</span>
              <textarea rows={2} value={form.supplierAddress} onChange={set("supplierAddress")} className={field} /></label>
            <label><span className={labelText}>Your email</span>
              <input type="email" value={form.supplierEmail} onChange={set("supplierEmail")} className={field} /></label>
            <label><span className={labelText}>Your PAN</span>
              <input value={form.supplierPan} onChange={set("supplierPan")} className={field} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">Your client</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label><span className={labelText}>Client name</span>
              <input required value={form.clientName} onChange={set("clientName")} className={field} /></label>
            <label><span className={labelText}>Client GSTIN (if they have one)</span>
              <input value={form.clientGstin} onChange={set("clientGstin")} className={field} /></label>
            <label className="sm:col-span-2"><span className={labelText}>Client address</span>
              <textarea rows={2} value={form.clientAddress} onChange={set("clientAddress")} className={field} /></label>
            <label><span className={labelText}>Client country</span>
              <input value={form.clientCountry} onChange={set("clientCountry")} className={field} /></label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-sm font-semibold">The work</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2"><span className={labelText}>What you did</span>
              <input required value={form.description} onChange={set("description")} placeholder="Website design and front-end build, March 2026" className={field} /></label>
            <label><span className={labelText}>SAC code</span>
              <input value={form.sacCode} onChange={set("sacCode")} className={field} />
              <span className="mt-1 block text-[12px] text-[var(--muted)]">9983 covers most professional and technical services. Check yours.</span></label>
            <label><span className={labelText}>Quantity</span>
              <input type="number" min="0" step="0.01" value={form.quantity} onChange={set("quantity")} className={field} /></label>
            <label><span className={labelText}>Rate (₹)</span>
              <input required type="number" min="0" step="0.01" value={form.unitPrice} onChange={set("unitPrice")} className={field} /></label>
            <label><span className={labelText}>GST rate</span>
              <select value={form.gstRatePct} onChange={set("gstRatePct")} className={field}>
                {["0", "5", "12", "18", "28"].map((r) => <option key={r} value={r}>{r}%</option>)}
              </select></label>
            <label><span className={labelText}>Invoice number</span>
              <input required maxLength={16} value={form.invoiceNumber} onChange={set("invoiceNumber")} className={field} />
              <span className="mt-1 block text-[12px] text-[var(--muted)]">Max 16 characters. Letters, digits, / and - only.</span></label>
            <label><span className={labelText}>Invoice date</span>
              <input type="date" value={form.invoiceDate} onChange={set("invoiceDate")} className={field} /></label>
            <label><span className={labelText}>Payment due</span>
              <input type="date" value={form.dueDate} onChange={set("dueDate")} className={field} /></label>
            <label><span className={labelText}>Late fee (% per month)</span>
              <input type="number" min="0" step="0.1" value={form.lateFeePctPerMonth} onChange={set("lateFeePctPerMonth")} className={field} /></label>
            <label className="sm:col-span-2"><span className={labelText}>Notes (bank details, PO number, anything else)</span>
              <textarea rows={2} value={form.notes} onChange={set("notes")} className={field} /></label>
          </div>
        </fieldset>

        <Errors error={tool.error} />
        <button type="submit" disabled={tool.busy}
          className="rounded-lg bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-ink)] disabled:opacity-50">
          {tool.busy ? "Building…" : "Make the invoice"}
        </button>

        <p className="text-[12px] leading-relaxed text-[var(--muted)]">
          {remembered
            ? "Your details and this client are remembered for next time, and the invoice number increments on its own."
            : "Your details and the client's will be remembered for next time."}{" "}
          All of it stays in this browser — your GSTIN, PAN and your clients&apos; details are
          never sent to us. Clearing site data, or opening this on another device, means typing
          them again.{" "}
          <button
            type="button"
            onClick={() => {
              forgetEverything();
              setClients([]);
              setRemembered(false);
            }}
            className="underline underline-offset-2"
          >
            Forget everything now
          </button>
          .
        </p>
      </form>

      {tool.result ? (
        <div id="out" className="mt-8 scroll-mt-6">
          <StatGrid items={[
            { label: "Total", value: formatInr(tool.result.totalMinor) },
            { label: "Taxable value", value: formatInr(tool.result.subtotalMinor) },
            { label: "Tax", value: formatInr(tool.result.totalTaxMinor) },
            { label: "Supply type", value: tool.result.supplyType.replace("-", " ") },
          ]} />

          <ResultSection title={tool.result.documentTitle} description={`Place of supply: ${tool.result.placeOfSupply}`}>
            <DataTable
              columns={["", "Amount"]}
              align={["left", "right"]}
              rows={[
                ["Taxable value", formatInr(tool.result.subtotalMinor)],
                ...tool.result.taxLines.map((line) => [
                  `${line.label} @ ${line.ratePct}%`,
                  formatInr(line.amountMinor),
                ]),
                [<strong key="t">Total</strong>, <strong key="v">{formatInr(tool.result.totalMinor)}</strong>],
              ]}
            />
            <p className="mt-3 text-sm text-[var(--muted)]">{tool.result.totalInWords}</p>
          </ResultSection>

          {tool.result.warnings.length > 0 ? (
            <ResultSection title="Check these before you send it">
              <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
                {tool.result.warnings.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            </ResultSection>
          ) : null}

          <ResultSection title="Declarations on the invoice">
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {tool.result.declarations.map((d) => <li key={d}>• {d}</li>)}
            </ul>
          </ResultSection>

          {tool.id ? <Download id={tool.id} label="Download the invoice PDF" /> : null}

          {invoiceCount >= 2 ? (
            <p className="mt-4 text-sm">
              <a href="/register" className="font-semibold text-[var(--accent)] underline underline-offset-4">
                See all {invoiceCount} invoices as a financial-year register
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --- advance tax -----------------------------------------------------------

function AdvanceTaxForm() {
  const tool = useTool<AdvanceTaxResult>("/api/advance-tax", "advance-tax");
  const [reminderEmail, setReminderEmail] = useState("");
  const [reminder, setReminder] = useState<{ dueDates: string[]; live: boolean } | null>(null);
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [remindBusy, setRemindBusy] = useState(false);
  const [form, setForm] = useState({
    grossReceipts: "",
    expenses: "",
    otherIncome: "",
    basis: "presumptive-44ada",
    regime: "new",
    deductions: "",
    tdsDeducted: "",
    alreadyPaid: "",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void tool.run(form);
        }}
        className="grid gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:grid-cols-2 sm:p-6"
      >
        <label><span className={labelText}>Expected gross receipts this year (₹)</span>
          <input required type="number" min="0" value={form.grossReceipts} onChange={set("grossReceipts")} className={field} /></label>
        <label><span className={labelText}>How are you taxed?</span>
          <select value={form.basis} onChange={set("basis")} className={field}>
            <option value="presumptive-44ada">Presumptive, section 44ADA (50% deemed profit)</option>
            <option value="actual-books">Actual books — I claim real expenses</option>
          </select></label>
        <label><span className={labelText}>Business expenses (₹)</span>
          <input type="number" min="0" value={form.expenses} onChange={set("expenses")} className={field} />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">Used only under actual books; under 44ADA the profit is fixed at 50%.</span></label>
        <label><span className={labelText}>Other income — interest, rent (₹)</span>
          <input type="number" min="0" value={form.otherIncome} onChange={set("otherIncome")} className={field} /></label>
        <label><span className={labelText}>Tax regime</span>
          <select value={form.regime} onChange={set("regime")} className={field}>
            <option value="new">New regime</option>
            <option value="old">Old regime</option>
          </select></label>
        <label><span className={labelText}>Deductions claimed, old regime only (₹)</span>
          <input type="number" min="0" value={form.deductions} onChange={set("deductions")} className={field} /></label>
        <label><span className={labelText}>TDS already deducted by clients (₹)</span>
          <input type="number" min="0" value={form.tdsDeducted} onChange={set("tdsDeducted")} className={field} />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">Check Form 26AS or the AIS on the income tax portal.</span></label>
        <label><span className={labelText}>Advance tax already paid (₹)</span>
          <input type="number" min="0" value={form.alreadyPaid} onChange={set("alreadyPaid")} className={field} /></label>

        <div className="sm:col-span-2">
          <Errors error={tool.error} />
          <button type="submit" disabled={tool.busy}
            className="mt-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-ink)] disabled:opacity-50">
            {tool.busy ? "Working…" : "Show my schedule"}
          </button>
        </div>
      </form>

      {tool.result ? (
        <div id="out" className="mt-8 scroll-mt-6">
          <StatGrid items={[
            { label: "Tax for the year", value: formatInr(tool.result.tax.total) },
            { label: "After TDS", value: formatInr(tool.result.liabilityAfterTdsMinor) },
            { label: "Still to pay", value: formatInr(tool.result.remainingToPayMinor) },
            { label: "Effective rate", value: `${tool.result.tax.effectiveRatePct}%` },
          ]} />

          {!tool.result.advanceTaxDue ? (
            <div className="mt-4"><Note>
              Your tax after TDS is below ₹10,000, so no advance tax is payable this year. You
              still need to file a return.
            </Note></div>
          ) : null}

          <ResultSection
            title="Your instalment schedule"
            description={
              tool.result.basis === "presumptive-44ada"
                ? "One instalment, because you are taxed under section 44ADA. The June, September and December dates do not apply to you."
                : "Four instalments, the standard schedule for actual-books taxation."
            }
          >
            <DataTable
              columns={["Due date", "Pay this instalment", "Cumulative", "Status"]}
              align={["left", "right", "right", "left"]}
              rows={tool.result.instalments.map((instalment) => [
                instalment.dueDate,
                formatInr(instalment.instalmentMinor),
                `${instalment.cumulativePct}% — ${formatInr(instalment.cumulativeMinor)}`,
                <Pill key="s" tone={instalment.status === "past" ? "bad" : instalment.status === "due-soon" ? "warn" : "neutral"}>
                  {instalment.status === "past"
                    ? `${Math.abs(instalment.daysAway)} days ago`
                    : `in ${instalment.daysAway} days`}
                </Pill>,
              ])}
            />
          </ResultSection>

          <ResultSection title="Both regimes on these numbers">
            <DataTable
              columns={["Regime", "Tax for the year"]}
              align={["left", "right"]}
              rows={tool.result.regimeCompared.map((row) => [
                row.regime === "new" ? "New regime" : "Old regime",
                formatInr(row.totalMinor),
              ])}
            />
          </ResultSection>

          <ResultSection title="How this was worked out">
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {tool.result.notes.map((n) => <li key={n}>• {n}</li>)}
            </ul>
          </ResultSection>

          <ResultSection title="Worth knowing">
            <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
              {tool.result.warnings.map((w) => <li key={w}>• {w}</li>)}
            </ul>
          </ResultSection>

          {tool.result.advanceTaxDue ? (
            <ResultSection
              title="Remind me before each due date"
              description="Missing an instalment costs 1% a month in interest under section 234C. One email per due date, ten days ahead — never a second for the same date."
            >
              {reminder ? (
                <Note>
                  {reminder.live ? (
                    <>
                      Set. You will hear from us ten days before{" "}
                      {reminder.dueDates.join(", ")} — once each, and nothing else.
                    </>
                  ) : (
                    <>
                      We saved the reminder for {reminder.dueDates.join(", ")}, but email is not
                      switched on for this deployment yet, so nothing will be sent. We would rather
                      tell you that than let you rely on it.
                    </>
                  )}
                </Note>
              ) : (
                <div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <input
                      type="email"
                      value={reminderEmail}
                      onChange={(e) => setReminderEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm sm:max-w-xs"
                    />
                    <button
                      type="button"
                      disabled={remindBusy || reminderEmail.length < 5}
                      onClick={async () => {
                        setRemindBusy(true);
                        setReminderError(null);
                        try {
                          const response = await fetch("/api/remind", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({ ...form, email: reminderEmail }),
                          });
                          const payload = (await response.json()) as {
                            dueDates?: string[];
                            live?: boolean;
                            error?: string;
                          };
                          if (!response.ok || payload.error || !payload.dueDates) {
                            setReminderError(payload.error ?? "Could not set the reminder.");
                            return;
                          }
                          setReminder({ dueDates: payload.dueDates, live: payload.live ?? false });
                        } catch (err) {
                          setReminderError(`Could not reach the server: ${(err as Error).message}`);
                        } finally {
                          setRemindBusy(false);
                        }
                      }}
                      className="rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm font-semibold text-[var(--accent-ink)] disabled:opacity-50"
                    >
                      {remindBusy ? "Setting…" : "Remind me"}
                    </button>
                  </div>
                  <p className="mt-2 text-[12px] text-[var(--muted)]">
                    We store the email and the schedule computed above, nothing else. The figures
                    come from what you entered — if your income changes, recompute and set it again.
                  </p>
                  {reminderError ? (
                    <p role="alert" className="mt-3 text-sm text-rose-700">
                      {reminderError}
                    </p>
                  ) : null}
                </div>
              )}
            </ResultSection>
          ) : null}

          {tool.id ? <Download id={tool.id} label="Download the schedule as PDF" /> : null}
        </div>
      ) : null}
    </div>
  );
}

// --- contract --------------------------------------------------------------

function ContractForm() {
  const tool = useTool<ContractResult>("/api/contract", "contract");
  const [rememberedDefaults, setRememberedDefaults] = useState(false);
  const [form, setForm] = useState({
    freelancerName: "",
    freelancerAddress: "",
    clientName: "",
    clientAddress: "",
    scope: "",
    deliverables: "",
    feeStructure: "fixed",
    fee: "",
    rate: "",
    paymentTermsDays: "30",
    advancePct: "30",
    lateFeePctPerMonth: "1.5",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    noticeDays: "15",
    jurisdictionCity: "",
    revisionRounds: "2",
    confidentialityMonths: "24",
    ipTransfersOnPayment: "yes",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  // Terms are the part nobody wants to re-decide; names change every time.
  useEffect(() => {
    const profile = readProfile();
    const savedName = profile.supplier?.name;
    if (savedName) setForm((prev) => ({ ...prev, freelancerName: savedName }));
    const defaults = profile.contractDefaults;
    if (defaults) {
      setRememberedDefaults(true);
      setForm((prev) => ({ ...prev, ...defaults }));
    }
  }, []);

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveContractDefaults({
            paymentTermsDays: form.paymentTermsDays,
            advancePct: form.advancePct,
            lateFeePctPerMonth: form.lateFeePctPerMonth,
            noticeDays: form.noticeDays,
            revisionRounds: form.revisionRounds,
            confidentialityMonths: form.confidentialityMonths,
            jurisdictionCity: form.jurisdictionCity,
            ipTransfersOnPayment: form.ipTransfersOnPayment,
          });
          setRememberedDefaults(true);

          void tool.run({ ...form, ipTransfersOnPayment: form.ipTransfersOnPayment === "yes" });
        }}
        className="grid gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 sm:grid-cols-2 sm:p-6"
      >
        <label><span className={labelText}>Your name</span>
          <input required value={form.freelancerName} onChange={set("freelancerName")} className={field} /></label>
        <label><span className={labelText}>Client name</span>
          <input required value={form.clientName} onChange={set("clientName")} className={field} /></label>
        <label><span className={labelText}>Your address</span>
          <input value={form.freelancerAddress} onChange={set("freelancerAddress")} className={field} /></label>
        <label><span className={labelText}>Client address</span>
          <input value={form.clientAddress} onChange={set("clientAddress")} className={field} /></label>
        <label className="sm:col-span-2"><span className={labelText}>What you are doing</span>
          <textarea required rows={3} value={form.scope} onChange={set("scope")}
            placeholder="Design and build a five-page marketing site in Next.js, including responsive layouts and a contact form."
            className={field} />
          <span className="mt-1 block text-[12px] text-[var(--muted)]">Be specific. A vague scope clause is the most common reason freelance disputes go badly.</span></label>
        <label className="sm:col-span-2"><span className={labelText}>Deliverables</span>
          <textarea rows={2} value={form.deliverables} onChange={set("deliverables")} className={field} /></label>
        <label><span className={labelText}>How you charge</span>
          <select value={form.feeStructure} onChange={set("feeStructure")} className={field}>
            <option value="fixed">Fixed fee</option>
            <option value="hourly">Hourly</option>
            <option value="monthly-retainer">Monthly retainer</option>
          </select></label>
        <label><span className={labelText}>{form.feeStructure === "fixed" ? "Total fee (₹)" : "Rate (₹)"}</span>
          <input type="number" min="0"
            value={form.feeStructure === "fixed" ? form.fee : form.rate}
            onChange={form.feeStructure === "fixed" ? set("fee") : set("rate")}
            className={field} /></label>
        <label><span className={labelText}>Advance (%)</span>
          <input type="number" min="0" max="100" value={form.advancePct} onChange={set("advancePct")} className={field} /></label>
        <label><span className={labelText}>Payment terms (days)</span>
          <input type="number" min="0" value={form.paymentTermsDays} onChange={set("paymentTermsDays")} className={field} /></label>
        <label><span className={labelText}>Late fee (% per month)</span>
          <input type="number" min="0" step="0.1" value={form.lateFeePctPerMonth} onChange={set("lateFeePctPerMonth")} className={field} /></label>
        <label><span className={labelText}>Revision rounds included</span>
          <input type="number" min="0" value={form.revisionRounds} onChange={set("revisionRounds")} className={field} /></label>
        <label><span className={labelText}>Start date</span>
          <input type="date" value={form.startDate} onChange={set("startDate")} className={field} /></label>
        <label><span className={labelText}>End date</span>
          <input type="date" value={form.endDate} onChange={set("endDate")} className={field} /></label>
        <label><span className={labelText}>Notice to terminate (days)</span>
          <input type="number" min="0" value={form.noticeDays} onChange={set("noticeDays")} className={field} /></label>
        <label><span className={labelText}>Courts of which city?</span>
          <input value={form.jurisdictionCity} onChange={set("jurisdictionCity")} placeholder="Bengaluru" className={field} /></label>
        <label><span className={labelText}>Who owns the finished work?</span>
          <select value={form.ipTransfersOnPayment} onChange={set("ipTransfersOnPayment")} className={field}>
            <option value="yes">Client owns it, once they have paid in full</option>
            <option value="no">I keep ownership and licence it to them</option>
          </select></label>
        <label><span className={labelText}>Confidentiality lasts (months)</span>
          <input type="number" min="0" value={form.confidentialityMonths} onChange={set("confidentialityMonths")} className={field} /></label>

        <div className="sm:col-span-2">
          <Errors error={tool.error} />
          <button type="submit" disabled={tool.busy}
            className="mt-2 rounded-lg bg-[var(--accent)] px-5 py-3 text-[15px] font-semibold text-[var(--accent-ink)] disabled:opacity-50">
            {tool.busy ? "Drafting…" : "Draft the contract"}
          </button>
          <p className="mt-3 text-[12px] leading-relaxed text-[var(--muted)]">
            {rememberedDefaults
              ? "Your usual terms — advance, payment days, late fee, notice, jurisdiction — were filled in from last time."
              : "Your terms will be remembered for next time, so only the names and the scope change."}{" "}
            Stored in this browser only.
          </p>
        </div>
      </form>

      {tool.result ? (
        <div id="out" className="mt-8 scroll-mt-6">
          <div className="mb-4"><Note>{tool.result.reviewNotice}</Note></div>

          {tool.result.warnings.length > 0 ? (
            <ResultSection title="Things worth reconsidering">
              <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
                {tool.result.warnings.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            </ResultSection>
          ) : null}

          <ResultSection title={tool.result.title} description={tool.result.preamble}>
            <div className="space-y-5">
              {tool.result.clauses.map((clause) => (
                <div key={clause.heading}>
                  <h4 className="text-[15px] font-semibold">{clause.heading}</h4>
                  {clause.body.split("\n\n").map((paragraph, index) => (
                    <p key={index} className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                      {paragraph}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          </ResultSection>

          {tool.id ? <Download id={tool.id} label="Download the contract PDF" /> : null}
        </div>
      ) : null}
    </div>
  );
}
