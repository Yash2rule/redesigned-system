import { india } from "@probes/core";
import type { InvoiceResult } from "./invoice.ts";

/**
 * The invoice register a CA asks for in March.
 *
 * One thing this states everywhere, because getting it wrong is expensive:
 * a register is what you INVOICED, not what you were PAID. Those are different
 * numbers and they matter for different taxes — GST is generally due by
 * reference to the time of supply rather than when the money arrives, and a
 * professional's income can be accounted differently again. This file totals
 * invoices. It does not know what was collected, and it says so.
 */

export type FinancialYear = { label: string; startIso: string; endIso: string };

/** The Indian financial year containing a date. April to March. */
export function financialYearOf(iso: string): FinancialYear {
  const date = new Date(`${iso}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? year : year - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`,
    startIso: `${startYear}-04-01`,
    endIso: `${startYear + 1}-03-31`,
  };
}

export type RegisterLine = {
  invoiceNumber: string;
  invoiceDate: string;
  clientName: string;
  clientGstin: string;
  placeOfSupply: string;
  supplyType: InvoiceResult["supplyType"];
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
};

export type ClientTotal = {
  name: string;
  gstin: string;
  invoices: number;
  taxableMinor: number;
  totalMinor: number;
};

export type RegisterResult = {
  financialYear: FinancialYear;
  lines: RegisterLine[];
  totals: {
    invoices: number;
    taxableMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    igstMinor: number;
    totalMinor: number;
  };
  byMonth: { month: string; label: string; invoices: number; taxableMinor: number; totalMinor: number }[];
  byClient: ClientTotal[];
  /** Invoice numbers that repeat — a real problem for a consecutive series. */
  duplicateNumbers: string[];
  outOfYear: number;
  notes: string[];
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const taxOf = (invoice: InvoiceResult, label: string): number =>
  invoice.taxLines
    .filter((line) => line.label === label)
    .reduce((sum, line) => sum + line.amountMinor, 0);

export function buildRegister(
  invoices: InvoiceResult[],
  fy: FinancialYear,
): RegisterResult {
  const lines: RegisterLine[] = [];
  let outOfYear = 0;

  for (const invoice of invoices) {
    const date = invoice.input.invoiceDate;
    if (!date || date < fy.startIso || date > fy.endIso) {
      outOfYear += 1;
      continue;
    }
    lines.push({
      invoiceNumber: invoice.input.invoiceNumber,
      invoiceDate: date,
      clientName: invoice.input.client.name,
      clientGstin: invoice.input.client.gstin,
      placeOfSupply: invoice.placeOfSupply,
      supplyType: invoice.supplyType,
      taxableMinor: invoice.subtotalMinor,
      cgstMinor: taxOf(invoice, "CGST"),
      sgstMinor: taxOf(invoice, "SGST"),
      igstMinor: taxOf(invoice, "IGST"),
      totalMinor: invoice.totalMinor,
    });
  }

  lines.sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));

  const sum = (pick: (line: RegisterLine) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);

  const monthMap = new Map<string, { invoices: number; taxableMinor: number; totalMinor: number }>();
  for (const line of lines) {
    const month = line.invoiceDate.slice(0, 7);
    const existing = monthMap.get(month) ?? { invoices: 0, taxableMinor: 0, totalMinor: 0 };
    existing.invoices += 1;
    existing.taxableMinor += line.taxableMinor;
    existing.totalMinor += line.totalMinor;
    monthMap.set(month, existing);
  }

  const clientMap = new Map<string, ClientTotal>();
  for (const line of lines) {
    const key = (line.clientGstin || line.clientName).toLowerCase();
    const existing = clientMap.get(key) ?? {
      name: line.clientName,
      gstin: line.clientGstin,
      invoices: 0,
      taxableMinor: 0,
      totalMinor: 0,
    };
    existing.invoices += 1;
    existing.taxableMinor += line.taxableMinor;
    existing.totalMinor += line.totalMinor;
    clientMap.set(key, existing);
  }

  // A consecutive series cannot repeat a number. If it does, one of these
  // invoices needs reissuing before anything is filed.
  const counts = new Map<string, number>();
  for (const line of lines) {
    counts.set(line.invoiceNumber, (counts.get(line.invoiceNumber) ?? 0) + 1);
  }
  const duplicateNumbers = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number);

  const notes: string[] = [
    `Financial year ${fy.label}: 1 April ${fy.startIso.slice(0, 4)} to 31 March ${fy.endIso.slice(0, 4)}.`,
    "This is what you invoiced, not what you were paid. Those are different numbers, and which one a given tax is computed on is a question for your CA — we do not know what was collected.",
    "Only invoices generated here are included. Anything you raised elsewhere is missing from these totals.",
  ];
  if (duplicateNumbers.length > 0) {
    notes.push(
      `Invoice number${duplicateNumbers.length === 1 ? "" : "s"} ${duplicateNumbers.join(", ")} appear more than once. An invoice series has to be consecutive and unique — fix this before filing.`,
    );
  }
  if (outOfYear > 0) {
    notes.push(`${outOfYear} invoice${outOfYear === 1 ? "" : "s"} fell outside this financial year and were left out.`);
  }

  return {
    financialYear: fy,
    lines,
    totals: {
      invoices: lines.length,
      taxableMinor: sum((l) => l.taxableMinor),
      cgstMinor: sum((l) => l.cgstMinor),
      sgstMinor: sum((l) => l.sgstMinor),
      igstMinor: sum((l) => l.igstMinor),
      totalMinor: sum((l) => l.totalMinor),
    },
    byMonth: [...monthMap.entries()]
      .map(([month, value]) => {
        const [year, m] = month.split("-");
        return { month, label: `${MONTHS[Number(m) - 1] ?? m} ${year}`, ...value };
      })
      .sort((a, b) => a.month.localeCompare(b.month)),
    byClient: [...clientMap.values()].sort((a, b) => b.totalMinor - a.totalMinor),
    duplicateNumbers,
    outOfYear,
    notes,
  };
}

/** Rough check against the GST registration threshold, framed as a prompt. */
export function turnoverNote(taxableMinor: number, registered: boolean): string | null {
  const THRESHOLD = 20_00_000 * 100;
  if (registered || taxableMinor < THRESHOLD * 0.8) return null;
  return taxableMinor >= THRESHOLD
    ? `You invoiced ${india.amountInWords(taxableMinor).replace("Rupees ", "₹").replace(" only", "")} this year with no GSTIN on these invoices. Registration is generally compulsory for services past ₹20 lakh a year (₹10 lakh in some special-category states). Talk to a CA about where you stand — this is a prompt, not a determination.`
    : `You are within about 20% of the ₹20 lakh services threshold where GST registration generally becomes compulsory. Worth a conversation with a CA before you cross it rather than after.`;
}
