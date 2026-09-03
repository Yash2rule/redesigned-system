import { formatInr, renderPdf } from "@probes/core/server";
import type { PdfSection } from "@probes/core/server";
import { config } from "./config.ts";
import type { InvoiceResult } from "./invoice.ts";
import type { AdvanceTaxResult } from "./advance-tax.ts";
import type { ContractResult } from "./contract.ts";

export async function buildInvoicePdf(result: InvoiceResult): Promise<Buffer> {
  const { input } = result;
  const sections: PdfSection[] = [
    {
      type: "keyValues",
      rows: [
        ["Invoice number", input.invoiceNumber],
        ["Invoice date", input.invoiceDate],
        ["Payment due", input.dueDate || "on receipt"],
        ["Place of supply", result.placeOfSupply],
        [
          "Supply type",
          result.supplyType === "intra-state"
            ? "Intra-state (CGST + SGST)"
            : result.supplyType === "inter-state"
              ? "Inter-state (IGST)"
              : result.supplyType === "export"
                ? "Export of services"
                : "Not applicable (supplier not GST-registered)",
        ],
      ],
    },
    { type: "heading", text: "From" },
    {
      type: "bullets",
      items: [
        input.supplier.name,
        input.supplier.address,
        input.supplier.gstin ? `GSTIN: ${input.supplier.gstin}` : "Not registered under GST",
        input.supplier.pan ? `PAN: ${input.supplier.pan}` : "",
        [input.supplier.email, input.supplier.phone].filter(Boolean).join(" · "),
      ].filter(Boolean),
    },
    { type: "heading", text: "To" },
    {
      type: "bullets",
      items: [
        input.client.name,
        input.client.address,
        input.client.gstin ? `GSTIN: ${input.client.gstin}` : "Unregistered recipient",
        input.client.country && input.client.country.toLowerCase() !== "india"
          ? `Country: ${input.client.country}`
          : "",
      ].filter(Boolean),
    },
    { type: "heading", text: "Items" },
    {
      type: "table",
      columns: ["Description", "SAC", "Qty", "Rate", "Amount"],
      rows: input.items.map((item) => [
        item.description,
        item.sacCode || "—",
        String(item.quantity),
        formatInr(item.unitPriceMinor),
        formatInr(Math.round(item.quantity * item.unitPriceMinor)),
      ]),
    },
    {
      type: "keyValues",
      rows: [
        ["Taxable value", formatInr(result.subtotalMinor)],
        ...result.taxLines.map(
          (line): [string, string] => [
            `${line.label} @ ${line.ratePct}%`,
            formatInr(line.amountMinor),
          ],
        ),
        ["Total", formatInr(result.totalMinor)],
      ],
    },
    { type: "paragraph", text: `Amount in words: ${result.totalInWords}` },
  ];

  if (input.lateFeePctPerMonth > 0) {
    sections.push({
      type: "paragraph",
      text: `Overdue amounts carry interest at ${input.lateFeePctPerMonth}% per month from the due date.`,
    });
  }
  if (input.notes.trim()) {
    sections.push({ type: "heading", text: "Notes" });
    sections.push({ type: "paragraph", text: input.notes.trim() });
  }

  sections.push({ type: "heading", text: "Declarations" });
  sections.push({ type: "bullets", items: result.declarations });

  return renderPdf({
    title: result.documentTitle,
    subtitle: `${input.invoiceNumber} · ${input.supplier.name} to ${input.client.name} · ${formatInr(result.totalMinor)}`,
    disclaimer: config.disclaimer,
    footerBrand: input.supplier.name || config.name,
    sections,
  });
}

export async function buildAdvanceTaxPdf(result: AdvanceTaxResult): Promise<Buffer> {
  const sections: PdfSection[] = [
    {
      type: "keyValues",
      rows: [
        ["Financial year", `${result.financialYear} (AY ${result.assessmentYear})`],
        [
          "Basis",
          result.basis === "presumptive-44ada"
            ? "Presumptive, section 44ADA"
            : "Actual books of account",
        ],
        ...(result.presumptiveProfitMinor !== null
          ? [["Deemed profit (50% of receipts)", formatInr(result.presumptiveProfitMinor)] as [string, string]]
          : []),
        ["Total income", formatInr(result.totalIncomeMinor)],
        ["Tax regime", result.tax.regime === "new" ? "New" : "Old"],
        ["Tax for the year", formatInr(result.tax.total)],
        ["Effective rate", `${result.tax.effectiveRatePct}%`],
        ["Payable after TDS", formatInr(result.liabilityAfterTdsMinor)],
        ["Advance tax applies", result.advanceTaxDue ? "Yes" : "No — below the ₹10,000 threshold"],
        ["Still to pay", formatInr(result.remainingToPayMinor)],
      ],
    },
    { type: "heading", text: "Instalment schedule" },
    {
      type: "table",
      columns: ["Due date", "Instalment", "Cumulative %", "Pay by then"],
      rows: result.instalments.map((instalment) => [
        instalment.dueDate,
        formatInr(instalment.instalmentMinor),
        `${instalment.cumulativePct}%`,
        formatInr(instalment.cumulativeMinor),
      ]),
    },
    { type: "heading", text: "Both regimes compared" },
    {
      type: "table",
      columns: ["Regime", "Tax for the year"],
      rows: result.regimeCompared.map((row) => [
        row.regime === "new" ? "New regime" : "Old regime",
        formatInr(row.totalMinor),
      ]),
    },
    { type: "heading", text: "How this was worked out" },
    { type: "bullets", items: result.notes },
    { type: "heading", text: "Worth knowing" },
    { type: "bullets", items: result.warnings },
  ];

  return renderPdf({
    title: "Advance tax schedule",
    subtitle: `FY ${result.financialYear} · ${formatInr(result.remainingToPayMinor)} still to pay`,
    disclaimer: config.disclaimer,
    footerBrand: config.name,
    sections,
  });
}

export async function buildContractPdf(result: ContractResult): Promise<Buffer> {
  const sections: PdfSection[] = [
    { type: "paragraph", text: result.preamble },
    { type: "divider" },
  ];

  for (const clause of result.clauses) {
    sections.push({ type: "subheading", text: clause.heading });
    for (const paragraph of clause.body.split("\n\n")) {
      sections.push({ type: "paragraph", text: paragraph });
    }
  }

  sections.push({ type: "divider" });
  sections.push({ type: "heading", text: "Signed" });
  sections.push({ type: "bullets", items: result.signatureBlock.filter(Boolean) });
  sections.push({ type: "divider" });
  sections.push({ type: "heading", text: "Before you send this" });
  sections.push({ type: "paragraph", text: result.reviewNotice });
  if (result.warnings.length > 0) {
    sections.push({ type: "bullets", items: result.warnings });
  }

  return renderPdf({
    title: result.title,
    subtitle: `${result.input.freelancerName} and ${result.input.clientName}`,
    disclaimer: result.reviewNotice,
    footerBrand: config.name,
    sections,
  });
}
