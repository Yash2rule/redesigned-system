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

    for (const note of sheetSpec.notes ?? []) {
      const row = sheet.addRow([note]);
      row.font = { bold: true, size: 10, color: { argb: "FF6B7280" } };
    }
    if ((sheetSpec.notes?.length ?? 0) > 0) sheet.addRow([]);

    // Configure the columns one at a time rather than assigning `sheet.columns`.
    // That setter writes a header row at row 1, on top of whatever is already
    // there — which silently ate the first note, and the splice that tried to
    // undo it deleted the overwritten row and left a blank one behind. Setting
    // width, key and style per column touches no cells.
    sheetSpec.columns.forEach((c, index) => {
      const column = sheet.getColumn(index + 1);
      column.key = c.key;
      column.width = c.width ?? Math.max(12, c.header.length + 4);
      if (c.numFmt) column.style = { numFmt: c.numFmt };
    });

    const header = sheet.addRow(sheetSpec.columns.map((c) => c.header));
    const headerRowIndex = header.number;
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
