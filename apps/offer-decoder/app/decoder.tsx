"use client";

import { useEffect, useState } from "react";
import { formatIndianShort, formatInr } from "@probes/core/money.ts";
import {
  AssumptionsPanel,
  DataTable,
  Note,
  Pill,
  ResultSection,
  StatGrid,
  UploadWidget,
} from "@probes/ui";
import type { DecodeResult } from "../lib/analyse.ts";
import { DISPLAY_ORDER } from "../lib/salary.ts";
import { readSavedOffers, saveOffer } from "../lib/saved.ts";

const STATES: { code: string; label: string }[] = [
  { code: "OTHER", label: "Not sure / other state" },
  { code: "KA", label: "Karnataka" },
  { code: "MH", label: "Maharashtra" },
  { code: "TN", label: "Tamil Nadu" },
  { code: "TS", label: "Telangana" },
  { code: "AP", label: "Andhra Pradesh" },
  { code: "DL", label: "Delhi" },
  { code: "UP", label: "Uttar Pradesh" },
  { code: "HR", label: "Haryana" },
  { code: "GJ", label: "Gujarat" },
  { code: "WB", label: "West Bengal" },
  { code: "KL", label: "Kerala" },
  { code: "RJ", label: "Rajasthan" },
  { code: "PB", label: "Punjab" },
  { code: "MP", label: "Madhya Pradesh" },
];

const SAMPLE = `Total CTC (per annum)            24,00,000
Basic Salary                      9,60,000
House Rent Allowance              4,80,000
Special Allowance                 4,44,800
Leave Travel Allowance              80,000
Employer PF Contribution          1,15,200
Gratuity                            46,176
Medical Insurance Premium           24,000
Performance Linked Variable Pay   2,40,000
Joining Bonus                     1,00,000

Notice period: 90 days from either side.
The joining bonus is refundable in full if you resign within 12 months of joining.
Variable pay is at the sole discretion of the management and is not guaranteed.
Your services may be transferred to any other location or group company.`;

const severityTone = { high: "bad", medium: "warn", low: "neutral" } as const;

export function Decoder() {
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const [state, setState] = useState("OTHER");
  const [pfBasis, setPfBasis] = useState("full-basic");
  const [payoutRatio, setPayoutRatio] = useState("0.7");
  const [savedCount, setSavedCount] = useState(0);

  // localStorage is only available after mount.
  useEffect(() => setSavedCount(readSavedOffers().length), []);

  function handleResult(payload: unknown) {
    const typed = payload as { id?: string; result?: DecodeResult };
    if (!typed.result) return;

    setResult(typed.result);
    setArtifactId(typed.id ?? null);

    // Remember it locally so it can be compared against the next one. Only the
    // id and a label are stored; the result itself stays on the server.
    if (typed.id) {
      const salary = typed.result.salary;
      saveOffer({
        id: typed.id,
        label: `${formatIndianShort(salary.ctc)} CTC · ${formatInr(salary.monthlyInHand)}/mo in hand`,
        decodedAt: new Date().toISOString(),
      });
      setSavedCount(readSavedOffers().length);
    }

    requestAnimationFrame(() =>
      document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  return (
    <div>
      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Which state will you work in?</span>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
          >
            {STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[12px] text-[var(--muted)]">
            Professional tax differs by state, and several states charge none.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">How does the company compute PF?</span>
          <select
            value={pfBasis}
            onChange={(e) => setPfBasis(e.target.value)}
            className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm"
          >
            <option value="full-basic">12% of my full basic (most IT companies)</option>
            <option value="wage-ceiling">Capped at the ₹15,000 statutory ceiling</option>
          </select>
          <span className="mt-1 block text-[12px] text-[var(--muted)]">
            Check a payslip if you have one. It moves take-home by a few thousand a month.
          </span>
        </label>
      </div>

      <label className="mb-4 block text-sm">
        <span className="mb-1.5 block font-medium">
          What do you realistically expect the variable to pay out?
        </span>
        <select
          value={payoutRatio}
          onChange={(e) => setPayoutRatio(e.target.value)}
          className="w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-sm sm:max-w-md"
        >
          <option value="1">100% — the full target, every year</option>
          <option value="0.85">85% — slightly below target</option>
          <option value="0.7">70% — a normal year at most companies</option>
          <option value="0.5">50% — a bad year</option>
          <option value="0">0% — assume it never pays</option>
        </select>
        <span className="mt-1 block text-[12px] text-[var(--muted)]">
          We show your take-home at full payout and at this figure, side by side. Ask HR what the
          company-wide payout actually was last year.
        </span>
      </label>

      <UploadWidget
        action="/api/decode"
        accept=".pdf,.txt,.csv"
        ctaLabel="Decode my offer"
        pasteLabel="Paste your CTC breakup, and the clauses if you have them"
        pastePlaceholder={SAMPLE}
        extraFields={{ state, pfBasis, downsidePayoutRatio: payoutRatio }}
        onResult={handleResult}
        helpText="PDFs with selectable text work. Scans and photos don't — we don't run OCR, and we won't guess at your numbers. Nothing is shared with your employer."
      />

      {result ? (
        <Result result={result} artifactId={artifactId} savedCount={savedCount} />
      ) : null}
    </div>
  );
}

function Result({
  result,
  artifactId,
  savedCount,
}: {
  result: DecodeResult;
  artifactId: string | null;
  savedCount: number;
}) {
  const { salary } = result;
  const componentByKey = new Map(result.components.map((c) => [c.key, c]));
  const payoutPct = Math.round(
    (salary.variableAtDownside / Math.max(salary.variableAtFullPayout, 1)) * 100,
  );

  return (
    <div id="result" className="mt-10 scroll-mt-6">
      <StatGrid
        items={[
          {
            label: "Monthly in-hand",
            value: formatInr(salary.monthlyInHand),
            hint: `after PF, professional tax and income tax`,
          },
          {
            label: "Headline CTC",
            value: formatIndianShort(salary.ctc),
            hint: salary.ctcWasStated ? "as stated in the letter" : "added up from components",
          },
          {
            label: "Conditional",
            value: `${salary.conditionalPct}%`,
            tone: salary.conditionalPct > 20 ? "warn" : "default",
            hint: "variable, ESOP and one-time bonuses",
          },
          {
            label: "Never reaches you as pay",
            value: `${salary.nonCashPct}%`,
            hint: "employer PF, gratuity, insurance",
          },
        ]}
      />

      {result.parseNotes.length > 0 ? (
        <div className="mt-4 space-y-2">
          {result.parseNotes.map((note) => (
            <Note key={note}>{note}</Note>
          ))}
        </div>
      ) : null}

      {salary.variablePay > 0 ? (
        <ResultSection
          title="If the variable pays out at a realistic rate"
          description={`The letter promises ${formatInr(salary.variableAtFullPayout)} of variable pay a year. Companies routinely pay a fraction of target.`}
        >
          <DataTable
            columns={["Scenario", "Variable received", "Effective monthly in-hand"]}
            align={["left", "right", "right"]}
            rows={[
              [
                "Variable pays 100% of target",
                formatInr(salary.variableAtFullPayout),
                formatInr(salary.monthlyInHand),
              ],
              [
                `Variable pays ${payoutPct}% of target`,
                formatInr(salary.variableAtDownside),
                formatInr(salary.monthlyInHandDownside),
              ],
              ["Variable pays nothing", formatInr(0), formatInr(salary.monthlyInHand - Math.round(salary.variableAtFullPayout / 12))],
            ]}
          />
        </ResultSection>
      ) : null}

      <ResultSection
        title="Where the CTC actually goes"
        description="Fixed cash is what your salary account sees. The middle group is real money that goes somewhere other than your bank. The last group is conditional."
      >
        <DataTable
          columns={["Component", "Group", "Per year", "Per month"]}
          align={["left", "left", "right", "right"]}
          rows={DISPLAY_ORDER.flatMap((row) => {
            const parsedValue = componentByKey.get(row.key)?.annual ?? 0;
            const value =
              row.key === "employerPf"
                ? salary.employerPf
                : row.key === "gratuity"
                  ? salary.gratuityProvision
                  : parsedValue;
            if (value <= 0) return [];
            return [
              [
                row.label,
                <span key="g" className="text-[var(--muted)]">
                  {row.group}
                </span>,
                formatInr(value),
                formatInr(Math.round(value / 12)),
              ],
            ];
          })}
        />
        {result.unmatched.length > 0 ? (
          <div className="mt-4">
            <Note>
              We could not categorise these lines, so they are in no total above:{" "}
              {result.unmatched.map((u) => `${u.label} (${formatInr(u.annual)})`).join(", ")}.
            </Note>
          </div>
        ) : null}
      </ResultSection>

      <ResultSection
        title="Tax, both regimes"
        description={`Computed under FY ${salary.financialYear} rules. The cheaper regime for these numbers is the ${salary.best.regime} regime.`}
      >
        <DataTable
          columns={["", "New regime", "Old regime"]}
          align={["left", "right", "right"]}
          rows={(() => {
            const byRegime = new Map(salary.regimes.map((r) => [r.regime, r]));
            const n = byRegime.get("new");
            const o = byRegime.get("old");
            const row = (label: string, pick: (x: typeof n) => number) => [
              label,
              formatInr(pick(n)),
              formatInr(pick(o)),
            ];
            return [
              row("Taxable income", (x) => x?.tax.taxableIncome ?? 0),
              row("Tax before rebate", (x) => x?.tax.slabTax ?? 0),
              row("Section 87A rebate", (x) => x?.tax.rebate87A ?? 0),
              row("Surcharge", (x) => x?.tax.surcharge ?? 0),
              row("Cess (4%)", (x) => x?.tax.cess ?? 0),
              row("Total tax for the year", (x) => x?.tax.total ?? 0),
            ];
          })()}
        />
      </ResultSection>

      {result.redFlags.length > 0 ? (
        <ResultSection
          title={`Clauses worth reading twice (${result.redFlags.length})`}
          description="Each one quotes your own letter. Nothing here is invented, and nothing here is legal advice — it is a checklist that saves you a first read."
        >
          <div className="space-y-4">
            {result.redFlags.map((flag) => (
              <div key={flag.id} className="rounded-lg border border-[var(--line)] p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-[15px] font-semibold">{flag.title}</h4>
                  <Pill tone={severityTone[flag.severity]}>{flag.severity} priority</Pill>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{flag.meaning}</p>
                <blockquote className="mt-3 border-l-2 border-[var(--accent)] pl-3 text-[13px] italic leading-relaxed text-[var(--muted)]">
                  “{flag.quote}”
                </blockquote>
                <p className="mt-3 text-sm">
                  <span className="font-semibold">Ask HR:</span> {flag.ask}
                </p>
              </div>
            ))}
          </div>
        </ResultSection>
      ) : (
        <ResultSection title="No red-flag clauses found">
          <Note>
            We did not match any known problem clause. That may mean the letter is clean, or it may
            mean you only pasted the salary table. Paste the full letter to check the clauses too.
          </Note>
        </ResultSection>
      )}

      {result.missingClauses.length > 0 ? (
        <ResultSection
          title="Not mentioned anywhere in what you gave us"
          description="Absence is not proof of anything — but each of these is worth a one-line email to HR."
        >
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
            {result.missingClauses.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </ResultSection>
      ) : null}

      {salary.gaps.length > 0 ? (
        <ResultSection title="Questions to put to HR before you sign">
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
            {salary.gaps.map((gap) => (
              <li key={gap}>• {gap}</li>
            ))}
          </ul>
        </ResultSection>
      ) : null}

      <ResultSection title="How this offer compares">
        {result.benchmark.available ? (
          <div>
            <DataTable
              columns={["", "This offer", "Median contributed offer"]}
              align={["left", "right", "right"]}
              rows={[
                ["Total CTC", formatIndianShort(salary.ctc), formatIndianShort(result.benchmark.medianCtc)],
                [
                  "Conditional share of CTC",
                  `${salary.conditionalPct}%`,
                  `${result.benchmark.medianConditionalPct}%`,
                ],
                ["Percentile by CTC", `${result.benchmark.ctcPercentile}th`, "—"],
              ]}
            />
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
              {result.benchmark.message}
            </p>
          </div>
        ) : (
          <Note>{result.benchmark.message}</Note>
        )}
      </ResultSection>

      <AssumptionsPanel items={salary.assumptions} />

      {artifactId ? (
        <div className="mt-6">
          <a
            href={`/api/report?id=${encodeURIComponent(artifactId)}`}
            className="inline-flex rounded-lg bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white"
          >
            Download this as a PDF
          </a>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Free, no email needed. Includes every assumption above so a CA can check it.
          </p>
        </div>
      ) : null}

      {savedCount >= 2 ? (
        <div className="mt-6">
          <a
            href="/compare"
            className="inline-flex rounded-lg border border-[var(--line)] px-5 py-3 text-sm font-semibold"
          >
            Compare this against your other {savedCount - 1} offer
            {savedCount - 1 === 1 ? "" : "s"}
          </a>
        </div>
      ) : savedCount === 1 ? (
        <p className="mt-6 text-[13px] text-[var(--muted)]">
          Decode a second offer and you can put them side by side.
        </p>
      ) : null}
    </div>
  );
}
