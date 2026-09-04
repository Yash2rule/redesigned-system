import { describe, expect, it } from "vitest";
import { renderPdf } from "./pdf.ts";
import { renderWorkbook } from "./excel.ts";

/**
 * These two renderers produce the only artefacts a customer forwards to
 * somebody else — a tax invoice to a client, a ledger to a CA. Both had bugs
 * that a "does it produce a file" test would have passed straight over: the
 * disclaimer reaching one page of three, and the first caveat line being
 * silently overwritten. So these assert the contents, not the file.
 */

const DISCLAIMER = "DISCLAIMER-MARKER: drafting assistance, not advice.";

describe("renderPdf", () => {
  /** Enough paragraphs to certainly spill past one page. */
  const longSections = Array.from({ length: 40 }, (_, i) => ({
    type: "paragraph" as const,
    text: `Paragraph ${i}. ${"Filler sentence to push this document onto several pages. ".repeat(4)}`,
  }));

  /** The page tree's /Count is the file's own answer for how many pages it has. */
  const pageCount = (pdf: Buffer): number =>
    Number((pdf.toString("latin1").match(/\/Count (\d+)/) ?? [])[1] ?? 0);

  it("does not pad the document with blank pages", async () => {
    // Writing a footer below the bottom margin used to read as overflow, so
    // pdfkit started a fresh page for it — which got its own footer. A
    // one-paragraph document came out as three pages, the last two empty.
    const pdf = await renderPdf({
      title: "Short",
      disclaimer: DISCLAIMER,
      footerBrand: "Probe",
      sections: [{ type: "paragraph", text: "One line." }],
    });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageCount(pdf)).toBe(1);
  });

  it("reaches every page of a long document, and adds none", async () => {
    const pdf = await renderPdf({
      title: "Multi-page",
      disclaimer: DISCLAIMER,
      footerBrand: "Probe",
      sections: longSections,
    });

    const pages = pageCount(pdf);
    expect(pages).toBeGreaterThan(1);

    // Every page object carries its own content stream. Before `bufferPages`,
    // `bufferedPageRange()` described only the final page, so the disclaimer
    // loop ran exactly once however long the document was.
    const raw = pdf.toString("latin1");
    expect((raw.match(/\/Contents \d+ \d+ R/g) ?? []).length).toBe(pages);

    // The footer is drawn once per page and says "of N". If the loop only
    // visited one page, N would not match the real page count.
    expect(pages).toBe((raw.match(/\/Type\s*\/Page[^s]/g) ?? []).length);
  });

  it("grows page count with content, not with footers", async () => {
    const short = await renderPdf({
      title: "A", disclaimer: DISCLAIMER, footerBrand: "P",
      sections: longSections.slice(0, 5),
    });
    const long = await renderPdf({
      title: "B", disclaimer: DISCLAIMER, footerBrand: "P",
      sections: longSections,
    });
    expect(pageCount(long)).toBeGreaterThan(pageCount(short));
  });
});

describe("renderWorkbook", () => {
  const NOTE_ONE = "This is what you INVOICED, not what you were paid.";
  const NOTE_TWO = "Only invoices generated here are included.";

  /** Read the sheet back out of the produced file rather than trusting the builder. */
  async function readBack(buffer: Buffer) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = wb.worksheets[0]!;
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      rows.push(values.slice(1).map((v) => (v == null ? "" : String(v))));
    });
    return rows;
  }

  it("keeps every note — the first one included", async () => {
    const buffer = await renderWorkbook({
      sheets: [
        {
          name: "Register",
          notes: [NOTE_ONE, NOTE_TWO],
          columns: [
            { header: "Invoice", key: "invoice" },
            { header: "Amount", key: "amount", numFmt: "#,##0.00" },
          ],
          rows: [{ invoice: "INV-001", amount: 1000 }],
        },
      ],
    });

    const rows = await readBack(buffer);
    expect(rows[0]?.[0]).toBe(NOTE_ONE);
    expect(rows[1]?.[0]).toBe(NOTE_TWO);
    // Exactly one blank separator, then the header — no stray extra row.
    expect(rows[2]?.join("")).toBe("");
    expect(rows[3]).toEqual(["Invoice", "Amount"]);
    expect(rows[4]).toEqual(["INV-001", "1000"]);
  });

  it("writes data through the column keys", async () => {
    // The old code got keys for free from the `columns` setter; setting them
    // per column has to keep that working or every data row comes out empty.
    const buffer = await renderWorkbook({
      sheets: [
        {
          name: "Keys",
          columns: [
            { header: "A", key: "a" },
            { header: "B", key: "b" },
          ],
          rows: [{ a: "left", b: "right" }],
        },
      ],
    });
    const rows = await readBack(buffer);
    expect(rows[0]).toEqual(["A", "B"]);
    expect(rows[1]).toEqual(["left", "right"]);
  });

  it("puts the header at row 1 when there are no notes", async () => {
    const buffer = await renderWorkbook({
      sheets: [{ name: "Bare", columns: [{ header: "Only", key: "only" }], rows: [{ only: "x" }] }],
    });
    const rows = await readBack(buffer);
    expect(rows[0]).toEqual(["Only"]);
    expect(rows[1]).toEqual(["x"]);
  });
});
