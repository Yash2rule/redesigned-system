import { renderWorkbook } from "@probes/core/server";
import { config } from "./config.ts";
import type { RegisterResult } from "./register.ts";

const rupees = (minor: number) => Number((minor / 100).toFixed(2));
const INR = '₹#,##0.00';

/** The workbook to hand a CA. Column names match what they expect to see. */
export async function buildRegisterWorkbook(register: RegisterResult): Promise<Buffer> {
  return renderWorkbook({
    creator: config.name,
    sheets: [
      {
        name: `Register ${register.financialYear.label}`,
        notes: [
          `Invoice register for FY ${register.financialYear.label}.`,
          ...register.notes,
          config.disclaimer,
        ],
        columns: [
          { header: "Invoice no.", key: "invoiceNumber", width: 18 },
          { header: "Date", key: "invoiceDate", width: 12 },
          { header: "Client", key: "clientName", width: 30 },
          { header: "Client GSTIN", key: "clientGstin", width: 20 },
          { header: "Place of supply", key: "placeOfSupply", width: 26 },
          { header: "Supply type", key: "supplyType", width: 16 },
          { header: "Taxable value", key: "taxable", width: 16, numFmt: INR },
          { header: "CGST", key: "cgst", width: 14, numFmt: INR },
          { header: "SGST", key: "sgst", width: 14, numFmt: INR },
          { header: "IGST", key: "igst", width: 14, numFmt: INR },
          { header: "Invoice total", key: "total", width: 16, numFmt: INR },
        ],
        rows: register.lines.map((line) => ({
          invoiceNumber: line.invoiceNumber,
          invoiceDate: line.invoiceDate,
          clientName: line.clientName,
          clientGstin: line.clientGstin || "unregistered",
          placeOfSupply: line.placeOfSupply,
          supplyType: line.supplyType,
          taxable: rupees(line.taxableMinor),
          cgst: rupees(line.cgstMinor),
          sgst: rupees(line.sgstMinor),
          igst: rupees(line.igstMinor),
          total: rupees(line.totalMinor),
        })),
      },
      {
        name: "Year-end summary",
        notes: register.notes,
        columns: [
          { header: "", key: "label", width: 34 },
          { header: "Amount", key: "value", width: 18, numFmt: INR },
        ],
        rows: [
          { label: "Invoices raised", value: register.totals.invoices },
          { label: "Taxable value", value: rupees(register.totals.taxableMinor) },
          { label: "CGST charged", value: rupees(register.totals.cgstMinor) },
          { label: "SGST charged", value: rupees(register.totals.sgstMinor) },
          { label: "IGST charged", value: rupees(register.totals.igstMinor) },
          { label: "Invoiced in total", value: rupees(register.totals.totalMinor) },
        ],
      },
      {
        name: "By month",
        columns: [
          { header: "Month", key: "label", width: 18 },
          { header: "Invoices", key: "invoices", width: 12 },
          { header: "Taxable value", key: "taxable", width: 16, numFmt: INR },
          { header: "Invoiced", key: "total", width: 16, numFmt: INR },
        ],
        rows: register.byMonth.map((month) => ({
          label: month.label,
          invoices: month.invoices,
          taxable: rupees(month.taxableMinor),
          total: rupees(month.totalMinor),
        })),
      },
      {
        name: "By client",
        columns: [
          { header: "Client", key: "name", width: 32 },
          { header: "GSTIN", key: "gstin", width: 20 },
          { header: "Invoices", key: "invoices", width: 12 },
          { header: "Taxable value", key: "taxable", width: 16, numFmt: INR },
          { header: "Invoiced", key: "total", width: 16, numFmt: INR },
        ],
        rows: register.byClient.map((client) => ({
          name: client.name,
          gstin: client.gstin || "unregistered",
          invoices: client.invoices,
          taxable: rupees(client.taxableMinor),
          total: rupees(client.totalMinor),
        })),
      },
    ],
  });
}
