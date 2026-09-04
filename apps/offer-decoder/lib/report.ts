import { formatInr, renderPdf } from "@probes/core/server";
import type { PdfSection } from "@probes/core/server";
import { config } from "./config.ts";
import { DISPLAY_ORDER } from "./salary.ts";
import type { DecodeResult } from "./analyse.ts";

const inr = (minor: number) => formatInr(minor);

/** Build the downloadable PDF for one decoded offer. */
export async function buildOfferReport(result: DecodeResult): Promise<Buffer> {
  const { salary } = result;
  const componentByKey = new Map(result.components.map((c) => [c.key, c]));

  const sections: PdfSection[] = [
    {
      type: "keyValues",
      rows: [
        ["Total CTC", inr(salary.ctc)],
        ["Monthly in-hand (estimated)", inr(salary.monthlyInHand)],
        [
          `Monthly in-hand if variable pays ${Math.round(
            (salary.variableAtDownside / Math.max(salary.variableAtFullPayout, 1)) * 100,
          )}%`,
          inr(salary.monthlyInHandDownside),
        ],
        ["Guaranteed fixed cash a year", inr(salary.guaranteedCashAnnual)],
        ["Conditional share of CTC", `${salary.conditionalPct}%`],
        ["In CTC but never paid as salary", `${salary.nonCashPct}%`],
        ["Tax regime used", salary.best.regime === "new" ? "New regime" : "Old regime"],
        ["Income tax for the year", inr(salary.best.tax.total)],
        ["Effective tax rate", `${salary.best.tax.effectiveRatePct}%`],
      ],
    },
    { type: "heading", text: "Where the CTC goes" },
    {
      type: "table",
      columns: ["Component", "Group", "Per year", "Per month"],
      rows: DISPLAY_ORDER.flatMap((row) => {
        const parsedValue = componentByKey.get(row.key)?.annual ?? 0;
        const derived =
          row.key === "employerPf"
            ? salary.employerPf
            : row.key === "gratuity"
              ? salary.gratuityProvision
              : parsedValue;
        if (derived <= 0) return [];
        return [[row.label, row.group, inr(derived), inr(Math.round(derived / 12))]];
      }),
    },
    { type: "heading", text: "Tax, both regimes" },
    {
      type: "table",
      columns: ["", "New regime", "Old regime"],
      rows: (() => {
        const byRegime = new Map(salary.regimes.map((r) => [r.regime, r]));
        const n = byRegime.get("new");
        const o = byRegime.get("old");
        return [
          ["Taxable income", inr(n?.tax.taxableIncome ?? 0), inr(o?.tax.taxableIncome ?? 0)],
          ["Tax before rebate", inr(n?.tax.slabTax ?? 0), inr(o?.tax.slabTax ?? 0)],
          ["Section 87A rebate", inr(n?.tax.rebate87A ?? 0), inr(o?.tax.rebate87A ?? 0)],
          ["Surcharge", inr(n?.tax.surcharge ?? 0), inr(o?.tax.surcharge ?? 0)],
          ["Cess (4%)", inr(n?.tax.cess ?? 0), inr(o?.tax.cess ?? 0)],
          ["Total tax", inr(n?.tax.total ?? 0), inr(o?.tax.total ?? 0)],
        ];
      })(),
    },
  ];

  if (result.redFlags.length > 0) {
    sections.push({ type: "heading", text: `Clauses worth reading twice (${result.redFlags.length})` });
    for (const flag of result.redFlags) {
      sections.push({ type: "subheading", text: `${flag.title} — ${flag.severity} priority` });
      sections.push({ type: "paragraph", text: flag.meaning });
      sections.push({ type: "paragraph", text: `From your letter: "${flag.quote}"` });
      sections.push({ type: "paragraph", text: `Ask HR: ${flag.ask}` });
    }
  }

  if (result.missingClauses.length > 0) {
    sections.push({ type: "heading", text: "Not mentioned anywhere in the letter" });
    sections.push({ type: "bullets", items: result.missingClauses });
  }

  if (salary.gaps.length > 0) {
    sections.push({ type: "heading", text: "Questions to put to HR before you sign" });
    sections.push({ type: "bullets", items: salary.gaps });
  }

  sections.push({ type: "heading", text: "Assumptions used to get these numbers" });
  sections.push({ type: "bullets", items: salary.assumptions });

  if (result.unmatched.length > 0) {
    sections.push({ type: "heading", text: "Lines we could not categorise" });
    sections.push({
      type: "paragraph",
      text: "These were not counted in any total. If one of them is real money, the figures above are understated.",
    });
    sections.push({
      type: "bullets",
      items: result.unmatched.map((u) => `${u.label} — ${inr(u.annual)}`),
    });
  }

  return renderPdf({
    title: "Offer decoded",
    subtitle: `${inr(salary.ctc)} CTC · estimated ${inr(salary.monthlyInHand)} a month in hand · FY ${salary.financialYear}`,
    disclaimer: config.disclaimer,
    footerBrand: config.name,
    sections,
  });
}
