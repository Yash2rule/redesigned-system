import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { india } from "@probes/core";
import { jsonRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as invoiceRoute } from "../app/api/invoice/route.ts";
import { POST as advanceTaxRoute } from "../app/api/advance-tax/route.ts";
import { POST as contractRoute } from "../app/api/contract/route.ts";
import { GET as documentRoute } from "../app/api/document/route.ts";
import { buildInvoice } from "./invoice.ts";
import type { InvoiceInput } from "./invoice.ts";
import { computeAdvanceTax } from "./advance-tax.ts";
import { buildContract } from "./contract.ts";

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

const baseInvoice = (overrides: Partial<InvoiceInput> = {}): InvoiceInput => ({
  supplier: {
    name: "Asha Menon",
    address: "12 Residency Road, Bengaluru 560025",
    gstin: "29ABCDE1234F1Z5", // 29 = Karnataka
    stateCode: "29",
    email: "asha@example.com",
    phone: "9876543210",
    pan: "ABCDE1234F",
  },
  client: {
    name: "Nimbus Design LLP",
    address: "40 Linking Road, Mumbai 400050",
    gstin: "27ABCDE5678G1Z2", // 27 = Maharashtra
    stateCode: "27",
    country: "India",
  },
  invoiceNumber: "INV-2026-001",
  invoiceDate: "2026-04-15",
  dueDate: "2026-05-15",
  items: [{ description: "Front-end development", sacCode: "9983", quantity: 1, unitPriceMinor: 100_000_00 }],
  gstRatePct: 18,
  exportUnderLut: false,
  notes: "",
  lateFeePctPerMonth: 1.5,
  ...overrides,
});

describe("GST invoice", () => {
  it("charges a single IGST line on an inter-state supply", () => {
    const result = buildInvoice(baseInvoice());
    expect(result.supplyType).toBe("inter-state");
    expect(result.taxLines).toHaveLength(1);
    expect(result.taxLines[0]?.label).toBe("IGST");
    expect(result.taxLines[0]?.ratePct).toBe(18);
    expect(result.taxLines[0]?.amountMinor).toBe(18_000_00);
    expect(result.totalMinor).toBe(118_000_00);
  });

  it("splits into CGST and SGST on an intra-state supply", () => {
    const result = buildInvoice(
      baseInvoice({
        client: {
          name: "Local Client",
          address: "MG Road, Bengaluru",
          gstin: "29ZZZZZ9999Z1Z9",
          stateCode: "29",
          country: "India",
        },
      }),
    );
    expect(result.supplyType).toBe("intra-state");
    expect(result.taxLines.map((l) => l.label)).toEqual(["CGST", "SGST"]);
    expect(result.taxLines.every((l) => l.ratePct === 9)).toBe(true);
    expect(result.totalTaxMinor).toBe(18_000_00);
    expect(result.totalMinor).toBe(118_000_00);
  });

  it("makes CGST and SGST add up exactly, even when the split is odd", () => {
    // ₹333.33 at 18% is 5999.94 paise; halved it would round to two 30.00
    // figures that do not sum back. The second line takes the remainder.
    const result = buildInvoice(
      baseInvoice({
        client: { name: "Local", address: "", gstin: "29ZZZZZ9999Z1Z9", stateCode: "29", country: "India" },
        items: [{ description: "x", sacCode: "9983", quantity: 1, unitPriceMinor: 33_333 }],
      }),
    );
    const sum = result.taxLines.reduce((s, l) => s + l.amountMinor, 0);
    expect(sum).toBe(result.totalTaxMinor);
    expect(result.subtotalMinor + result.totalTaxMinor).toBe(result.totalMinor);
  });

  it("derives the states from the GSTINs, not from the state fields", () => {
    // State fields say the same state; the GSTINs say different ones.
    const result = buildInvoice(
      baseInvoice({
        supplier: { ...baseInvoice().supplier, stateCode: "27" },
        client: { ...baseInvoice().client, stateCode: "27" },
      }),
    );
    expect(result.supplyType).toBe("inter-state");
  });

  it("refuses to charge GST when the supplier has no GSTIN", () => {
    const result = buildInvoice(
      baseInvoice({ supplier: { ...baseInvoice().supplier, gstin: "" }, gstRatePct: 18 }),
    );
    expect(result.registered).toBe(false);
    expect(result.documentTitle).toBe("Invoice");
    expect(result.taxLines).toHaveLength(0);
    expect(result.totalMinor).toBe(result.subtotalMinor);
    expect(result.warnings.join(" ")).toContain("no authority to collect");
    expect(result.declarations.join(" ")).toContain("not registered under GST");
  });

  it("rejects a malformed supplier GSTIN rather than producing a bad invoice", () => {
    expect(() => buildInvoice(baseInvoice({ supplier: { ...baseInvoice().supplier, gstin: "29ABCDE" } }))).toThrow(
      /shaped like a GSTIN/,
    );
  });

  it("warns about a malformed client GSTIN without refusing the invoice", () => {
    const result = buildInvoice(
      baseInvoice({ client: { ...baseInvoice().client, gstin: "NOTAGSTIN" } }),
    );
    expect(result.warnings.join(" ")).toContain("not shaped like a valid GSTIN");
    expect(result.totalMinor).toBeGreaterThan(0);
  });

  it("enforces the 16-character invoice number rule", () => {
    expect(() => buildInvoice(baseInvoice({ invoiceNumber: "INVOICE-2026-000000123" }))).toThrow(
      /16 characters/,
    );
    expect(() => buildInvoice(baseInvoice({ invoiceNumber: "INV#2026" }))).toThrow(/16 characters/);
    expect(buildInvoice(baseInvoice({ invoiceNumber: "INV/2026-01" })).totalMinor).toBeGreaterThan(0);
  });

  it("zero-rates an export under LUT and explains the LUT condition", () => {
    const result = buildInvoice(
      baseInvoice({
        client: { name: "Helios Inc", address: "Austin, TX", gstin: "", stateCode: "", country: "United States" },
        exportUnderLut: true,
      }),
    );
    expect(result.supplyType).toBe("export");
    expect(result.taxLines).toHaveLength(0);
    expect(result.declarations.join(" ")).toContain("Letter of Undertaking");
    expect(result.warnings.join(" ")).toContain("filed again each year");
  });

  it("charges IGST on an export not under LUT", () => {
    const result = buildInvoice(
      baseInvoice({
        client: { name: "Helios Inc", address: "Austin, TX", gstin: "", stateCode: "", country: "United States" },
        exportUnderLut: false,
      }),
    );
    expect(result.taxLines[0]?.label).toBe("IGST");
    expect(result.declarations.join(" ")).toContain("refund claimed");
  });

  it("puts the total in words, in Indian numbering", () => {
    const result = buildInvoice(baseInvoice());
    expect(result.totalInWords).toBe("Rupees One Lakh Eighteen Thousand only");
  });

  it("rejects a rate that is not a real GST rate", () => {
    expect(() => buildInvoice(baseInvoice({ gstRatePct: 15 }))).toThrow(/not a GST rate/);
  });

  it("asks for a SAC code when one is missing", () => {
    const result = buildInvoice(
      baseInvoice({ items: [{ description: "x", sacCode: "", quantity: 1, unitPriceMinor: 1000_00 }] }),
    );
    expect(result.warnings.join(" ")).toContain("no SAC code");
  });
});

describe("advance tax", () => {
  const input = {
    grossReceiptsMinor: 24_00_000 * 100,
    expensesMinor: 0,
    otherIncomeMinor: 0,
    basis: "presumptive-44ada" as const,
    regime: "new" as const,
    deductionsMinor: 0,
    tdsDeductedMinor: 0,
    alreadyPaidMinor: 0,
  };

  it("deems 50% of receipts to be profit under 44ADA", () => {
    const result = computeAdvanceTax(input);
    expect(result.presumptiveProfitMinor).toBe(12_00_000 * 100);
    expect(result.totalIncomeMinor).toBe(12_00_000 * 100);
  });

  it("gives a 44ADA professional ONE instalment, due 15 March", () => {
    const result = computeAdvanceTax(input);
    expect(result.instalments).toHaveLength(1);
    expect(result.instalments[0]?.dueDate).toBe("2026-03-15");
    expect(result.instalments[0]?.cumulativePct).toBe(100);
    expect(result.notes.join(" ")).toContain("one instalment by 15 March");
  });

  it("gives an actual-books professional the four standard instalments", () => {
    const result = computeAdvanceTax({ ...input, basis: "actual-books", expensesMinor: 12_00_000 * 100 });
    expect(result.instalments.map((i) => i.dueDate)).toEqual([
      "2025-06-15",
      "2025-09-15",
      "2025-12-15",
      "2026-03-15",
    ]);
    expect(result.instalments.map((i) => i.cumulativePct)).toEqual([15, 45, 75, 100]);
  });

  it("makes the instalments add up to the full liability", () => {
    const result = computeAdvanceTax({ ...input, basis: "actual-books", expensesMinor: 4_00_000 * 100 });
    const sum = result.instalments.reduce((s, i) => s + i.instalmentMinor, 0);
    expect(sum).toBe(result.liabilityAfterTdsMinor);
  });

  it("does not apply the salaried standard deduction to freelance income", () => {
    // ₹12,00,000 of professional income, no salary. Under the new regime the
    // standard deduction must NOT apply, so tax is not zero here even though a
    // salaried person on ₹12,00,000 would pay nothing.
    const result = computeAdvanceTax(input);
    expect(result.tax.taxableIncome).toBe(12_00_000 * 100);
    expect(result.tax.total).toBe(0); // 87A rebate still applies at exactly ₹12L
    const higher = computeAdvanceTax({ ...input, grossReceiptsMinor: 30_00_000 * 100 });
    expect(higher.tax.taxableIncome).toBe(15_00_000 * 100);
  });

  it("says no advance tax is due below the ₹10,000 threshold", () => {
    const result = computeAdvanceTax({ ...input, grossReceiptsMinor: 10_00_000 * 100 });
    expect(result.advanceTaxDue).toBe(false);
    expect(result.instalments.every((i) => i.instalmentMinor === 0)).toBe(true);
    expect(result.notes.join(" ")).toContain("below ₹10,000");
  });

  it("subtracts TDS already deducted", () => {
    const withoutTds = computeAdvanceTax({ ...input, grossReceiptsMinor: 40_00_000 * 100 });
    const withTds = computeAdvanceTax({
      ...input,
      grossReceiptsMinor: 40_00_000 * 100,
      tdsDeductedMinor: 2_00_000 * 100,
    });
    expect(withTds.liabilityAfterTdsMinor).toBe(withoutTds.liabilityAfterTdsMinor - 2_00_000 * 100);
  });

  it("refuses 44ADA above the ₹75 lakh receipts ceiling", () => {
    expect(() =>
      computeAdvanceTax({ ...input, grossReceiptsMinor: 80_00_000 * 100 }),
    ).toThrow(/75 lakh/);
  });

  it("points out when the other regime would be cheaper", () => {
    const result = computeAdvanceTax({
      ...input,
      grossReceiptsMinor: 30_00_000 * 100,
      regime: "old",
      deductionsMinor: 0,
    });
    expect(result.warnings.join(" ")).toContain("regime would cost about");
  });

  it("flags instalment dates that have already passed unpaid", () => {
    const result = computeAdvanceTax(
      { ...input, basis: "actual-books", expensesMinor: 4_00_000 * 100 },
      new Date("2026-01-10T00:00:00Z"),
    );
    expect(result.warnings.join(" ")).toContain("234C");
    expect(result.instalments.filter((i) => i.status === "past")).toHaveLength(3);
  });

  it("uses the shared tax engine, so both probes agree on the same income", () => {
    const viaKit = computeAdvanceTax({ ...input, grossReceiptsMinor: 40_00_000 * 100 });
    const direct = india.computeIncomeTax(
      20_00_000 * 100 + india.STANDARD_DEDUCTION.new,
      "new",
    );
    expect(viaKit.tax.total).toBe(direct.total);
  });
});

describe("contract", () => {
  const input = {
    freelancerName: "Asha Menon",
    freelancerAddress: "Bengaluru",
    clientName: "Nimbus Design LLP",
    clientAddress: "Mumbai",
    scope: "Design and build a five-page marketing site.",
    deliverables: "Figma file, deployed site, source repository.",
    feeMinor: 2_00_000 * 100,
    feeStructure: "fixed" as const,
    rateMinor: 0,
    paymentTermsDays: 30,
    advancePct: 30,
    lateFeePctPerMonth: 1.5,
    startDate: "2026-04-01",
    endDate: "2026-06-30",
    noticeDays: 15,
    jurisdictionCity: "Bengaluru",
    revisionRounds: 2,
    ipTransfersOnPayment: true,
    confidentialityMonths: 24,
  };

  it("produces twelve clauses with the details filled in", () => {
    const result = buildContract(input);
    expect(result.clauses).toHaveLength(12);
    expect(result.preamble).toContain("Asha Menon");
    expect(result.preamble).toContain("Nimbus Design LLP");
    expect(result.clauses[2]?.body).toContain("₹2,00,000");
    expect(result.clauses[2]?.body).toContain("30 days");
  });

  it("never cites a section, rule or act", () => {
    const text = buildContract(input).clauses.map((c) => c.body).join(" ");
    expect(text).not.toMatch(/section\s+\d+/i);
    expect(text).not.toMatch(/\bu\/s\b/i);
    expect(text).not.toMatch(/Act,?\s+\d{4}/);
  });

  it("says plainly that it is not legal advice", () => {
    const result = buildContract(input);
    expect(result.reviewNotice).toContain("not legal advice");
    expect(result.reviewNotice).toContain("have a lawyer read it");
  });

  it("ties the IP assignment to payment in full", () => {
    const clause = buildContract(input).clauses.find((c) => c.heading.includes("owns"));
    expect(clause?.body).toContain("payment in full");
    expect(clause?.body).toContain("Until payment is received in full");
  });

  it("switches to a licence when the freelancer keeps ownership", () => {
    const result = buildContract({ ...input, ipTransfersOnPayment: false });
    const clause = result.clauses.find((c) => c.heading.includes("owns"));
    expect(clause?.body).toContain("non-exclusive licence");
    expect(result.warnings.join(" ")).toContain("kept ownership");
  });

  it("warns about no advance and no late fee", () => {
    const result = buildContract({ ...input, advancePct: 0, lateFeePctPerMonth: 0 });
    expect(result.warnings.join(" ")).toContain("No advance");
    expect(result.warnings.join(" ")).toContain("No late fee");
  });

  it("insists on a scope description", () => {
    expect(() => buildContract({ ...input, scope: "  " })).toThrow(/Describe the work/);
  });
});

describe("routes", () => {
  it("builds an invoice and renders it as a PDF", async () => {
    const response = await invoiceRoute(
      jsonRequest("http://localhost/api/invoice", {
        supplier: { name: "Asha Menon", gstin: "29ABCDE1234F1Z5", address: "Bengaluru" },
        client: { name: "Nimbus", gstin: "27ABCDE5678G1Z2", address: "Mumbai", country: "India" },
        invoiceNumber: "INV-2026-002",
        invoiceDate: "2026-04-15",
        items: [{ description: "Work", sacCode: "9983", quantity: 1, unitPrice: 50000 }],
        gstRatePct: 18,
      }),
    );
    expect(response.status).toBe(200);
    const { id, result } = (await response.json()) as { id: string; result: any };
    expect(result.totalMinor).toBe(59_000_00);

    const pdf = await documentRoute(new Request(`http://localhost/api/document?id=${id}`));
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("returns a usable error for a bad invoice rather than a 500", async () => {
    const response = await invoiceRoute(
      jsonRequest("http://localhost/api/invoice", {
        supplier: { name: "A", gstin: "BROKEN" },
        client: { name: "B" },
        invoiceNumber: "INV-1",
        items: [{ description: "x", unitPrice: 100 }],
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("GSTIN");
  });

  it("builds an advance tax schedule and renders it", async () => {
    const response = await advanceTaxRoute(
      jsonRequest("http://localhost/api/advance-tax", {
        grossReceipts: 2400000,
        basis: "presumptive-44ada",
        regime: "new",
      }),
    );
    expect(response.status).toBe(200);
    const { id, result } = (await response.json()) as { id: string; result: any };
    expect(result.instalments).toHaveLength(1);

    const pdf = await documentRoute(new Request(`http://localhost/api/document?id=${id}`));
    expect(pdf.status).toBe(200);
  });

  it("builds a contract and renders it", async () => {
    const response = await contractRoute(
      jsonRequest("http://localhost/api/contract", {
        freelancerName: "Asha",
        clientName: "Nimbus",
        scope: "Build a site.",
        fee: 200000,
        feeStructure: "fixed",
      }),
    );
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: string };

    const pdf = await documentRoute(new Request(`http://localhost/api/document?id=${id}`));
    expect(pdf.status).toBe(200);
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(4000);
  });

  it("404s an unknown document id", async () => {
    const response = await documentRoute(new Request("http://localhost/api/document?id=nope"));
    expect(response.status).toBe(404);
  });
});

describe("GST rate validation applies on every path", () => {
  const foreign = {
    name: "Helios GmbH",
    address: "Rosenthaler Str 40, Berlin",
    gstin: "",
    stateCode: "",
    country: "Germany",
  };

  it("refuses an invented rate on a domestic invoice", () => {
    expect(() => buildInvoice(baseInvoice({ gstRatePct: 500 }))).toThrow(/not a GST rate/);
  });

  it("refuses an invented rate on an export invoice too", () => {
    // The guard used to sit in the `else if` after the export branch, so an
    // export charging integrated tax was never checked at all — a 500% IGST
    // line would have rendered onto a document somebody acts on.
    expect(() =>
      buildInvoice(baseInvoice({ client: foreign, gstRatePct: 500 })),
    ).toThrow(/not a GST rate/);
    expect(() =>
      buildInvoice(baseInvoice({ client: foreign, gstRatePct: -18 })),
    ).toThrow(/not a GST rate/);
  });

  it("still accepts every real rate, export or not", () => {
    for (const gstRatePct of [0, 5, 12, 18, 28]) {
      expect(() => buildInvoice(baseInvoice({ gstRatePct }))).not.toThrow();
      expect(() => buildInvoice(baseInvoice({ client: foreign, gstRatePct }))).not.toThrow();
    }
  });

  it("charges the validated rate as IGST on an export with tax", () => {
    const result = buildInvoice(
      baseInvoice({ client: foreign, gstRatePct: 18, exportUnderLut: false }),
    );
    const igst = result.taxLines.find((line) => line.label === "IGST");
    expect(igst?.ratePct).toBe(18);
    expect(igst?.amountMinor).toBe(Math.round((100_000_00 * 18) / 100));
  });
});
