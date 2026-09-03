import type PDFKit from "pdfkit";

export type PdfSection =
  | { type: "heading"; text: string }
  | { type: "subheading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "keyValues"; rows: [string, string][] }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "divider" }
  | { type: "spacer"; height?: number };

export type PdfDocumentSpec = {
  title: string;
  subtitle?: string;
  /** Rendered in small grey type at the bottom of every page. */
  disclaimer: string;
  sections: PdfSection[];
  footerBrand?: string;
};

const INK = "#111827";
const MUTED = "#6b7280";
const RULE = "#e5e7eb";

/**
 * Render a spec to a PDF buffer with pdfkit.
 *
 * Deliberately kept to pdfkit's built-in Helvetica: bundling a font that
 * covers Devanagari and Gujarati would add megabytes to every deployment, and
 * none of tonight's four probes emit non-Latin text in a PDF.
 */
export async function renderPdf(spec: PdfDocumentSpec): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc: PDFKit.PDFDocument = new PDFDocument({
    size: "A4",
    margins: { top: 56, bottom: 72, left: 56, right: 56 },
    info: { Title: spec.title },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(spec.title);
  if (spec.subtitle) {
    doc.moveDown(0.3).font("Helvetica").fontSize(10).fillColor(MUTED).text(spec.subtitle);
  }
  doc.moveDown(1);

  const rule = () => {
    const y = doc.y;
    doc
      .strokeColor(RULE)
      .lineWidth(1)
      .moveTo(doc.page.margins.left, y)
      .lineTo(doc.page.margins.left + width, y)
      .stroke();
    doc.moveDown(0.6);
  };

  for (const section of spec.sections) {
    switch (section.type) {
      case "heading":
        doc.moveDown(0.6).fillColor(INK).font("Helvetica-Bold").fontSize(14).text(section.text);
        doc.moveDown(0.3);
        break;
      case "subheading":
        doc.moveDown(0.4).fillColor(INK).font("Helvetica-Bold").fontSize(11).text(section.text);
        doc.moveDown(0.2);
        break;
      case "paragraph":
        doc.fillColor(INK).font("Helvetica").fontSize(10).text(section.text, { align: "left" });
        doc.moveDown(0.4);
        break;
      case "bullets":
        doc.fillColor(INK).font("Helvetica").fontSize(10);
        for (const item of section.items) {
          doc.text(`•  ${item}`, { indent: 6, paragraphGap: 2 });
        }
        doc.moveDown(0.4);
        break;
      case "keyValues": {
        doc.fontSize(10);
        for (const [key, value] of section.rows) {
          const y = doc.y;
          doc.font("Helvetica").fillColor(MUTED).text(key, doc.page.margins.left, y, {
            width: width * 0.58,
            continued: false,
          });
          doc
            .font("Helvetica-Bold")
            .fillColor(INK)
            .text(value, doc.page.margins.left + width * 0.58, y, {
              width: width * 0.42,
              align: "right",
            });
          doc.moveDown(0.15);
        }
        doc.moveDown(0.4);
        break;
      }
      case "table": {
        const colWidth = width / Math.max(section.columns.length, 1);
        doc.fontSize(9).font("Helvetica-Bold").fillColor(MUTED);
        let y = doc.y;
        section.columns.forEach((col, i) => {
          doc.text(col, doc.page.margins.left + i * colWidth, y, {
            width: colWidth - 6,
            align: i === 0 ? "left" : "right",
          });
        });
        doc.moveDown(0.4);
        rule();
        doc.font("Helvetica").fillColor(INK);
        for (const row of section.rows) {
          if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
            doc.addPage();
          }
          y = doc.y;
          row.forEach((cell, i) => {
            doc.text(cell, doc.page.margins.left + i * colWidth, y, {
              width: colWidth - 6,
              align: i === 0 ? "left" : "right",
            });
          });
          doc.moveDown(0.25);
        }
        doc.moveDown(0.4);
        break;
      }
      case "divider":
        rule();
        break;
      case "spacer":
        doc.moveDown((section.height ?? 12) / 12);
        break;
    }
  }

  // Disclaimer on every page. Non-negotiable for the tax-adjacent probes.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.height - doc.page.margins.bottom + 18;
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(MUTED)
      .text(spec.disclaimer, doc.page.margins.left, bottom, { width, align: "left" });
    if (spec.footerBrand) {
      doc.text(`${spec.footerBrand}  ·  page ${i - range.start + 1} of ${range.count}`, doc.page.margins.left, bottom + 18, {
        width,
        align: "left",
      });
    }
  }

  doc.end();
  return done;
}
