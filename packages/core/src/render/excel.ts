export type SheetColumn = {
  header: string;
  key: string;
  width?: number;
  /** exceljs number format, e.g. '#,##0.00' or '₹#,##0.00'. */
  numFmt?: string;
};

export type SheetSpec = {
  name: string;
  columns: SheetColumn[];
  rows: Record<string, string | number | null>[];
  /** Rendered above the table as bold context lines. */
  notes?: string[];
};

export type WorkbookSpec = {
  creator?: string;
  sheets: SheetSpec[];
};

/**
 * Build an .xlsx buffer. exceljs is imported lazily so probes that never
 * export a spreadsheet don't pay for it on cold start.
 */
export async function renderWorkbook(spec: WorkbookSpec): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = spec.creator ?? "Validation Probes";
  workbook.created = new Date();

  for (const sheetSpec of spec.sheets) {
    // Excel forbids : \ / ? * [ ] in sheet names and caps them at 31 chars.
    const sheet = workbook.addWorksheet(sheetSpec.name.replace(/[:\\/?*[\]]/g, "-").slice(0, 31));

    let headerRowIndex = 1;
    for (const note of sheetSpec.notes ?? []) {
      const row = sheet.addRow([note]);
      row.font = { bold: true, size: 10, color: { argb: "FF6B7280" } };
      headerRowIndex += 1;
    }
    if ((sheetSpec.notes?.length ?? 0) > 0) {
      sheet.addRow([]);
      headerRowIndex += 1;
    }

    sheet.columns = sheetSpec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? Math.max(12, c.header.length + 4),
      style: c.numFmt ? { numFmt: c.numFmt } : {},
    }));

    // Setting `columns` writes the header at row 1; when notes pushed it down,
    // re-emit the header where it belongs.
    if (headerRowIndex > 1) {
      sheet.spliceRows(1, 1);
      sheet.insertRow(headerRowIndex, sheetSpec.columns.map((c) => c.header));
    }

    const header = sheet.getRow(headerRowIndex);
    header.font = { bold: true };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF3F4F6" },
    };
    header.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };

    for (const rowData of sheetSpec.rows) {
      sheet.addRow(sheetSpec.columns.map((c) => rowData[c.key] ?? null));
    }

    sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];
    sheet.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: Math.max(sheetSpec.columns.length, 1) },
    };
  }

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}
