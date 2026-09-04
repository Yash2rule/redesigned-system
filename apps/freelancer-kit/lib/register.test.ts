import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jsonRequest, useTempStore } from "../../../tests/helpers.ts";
import { POST as invoiceRoute } from "../app/api/invoice/route.ts";
import { POST as registerRoute } from "../app/api/register/route.ts";
import { buildInvoice } from "./invoice.ts";
import type { InvoiceInput } from "./invoice.ts";
import { buildRegister, financialYearOf, turnoverNote } from "./register.ts";

let store: ReturnType<typeof useTempStore>;
beforeAll(() => {
  store = useTempStore();
});
afterAll(() => store.cleanup());

const invoice = (over: Partial<InvoiceInput> = {}, clientOver = {}) =>
  buildInvoice({
    supplier: {
      name: "Asha Menon",
      address: "Bengaluru",
      gstin: "29ABCDE1234F1Z5",
      stateCode: "29",
      email: "",
      phone: "",
      pan: "",
    },
    client: {
      name: "Nimbus Design LLP",
      address: "Mumbai",
      gstin: "27ABCDE5678G1Z2",
      stateCode: "27",
      country: "India",
      ...clientOver,
    },
    invoiceNumber: "INV-001",
    invoiceDate: "2026-05-10",
    dueDate: "",
    items: [{ description: "Work", sacCode: "9983", quantity: 1, unitPriceMinor: 100_000_00 }],
    gstRatePct: 18,
    exportUnderLut: false,
    notes: "",
    lateFeePctPerMonth: 0,
    ...over,
  });

describe("the register", () => {
  it("totals taxable value and each tax separately", () => {
    const fy = financialYearOf("2026-05-10");
    const register = buildRegister(
      [
        invoice(), // inter-state: IGST
        invoice(
          { invoiceNumber: "INV-002" },
          { name: "Local Co", gstin: "29ZZZZZ9999Z1Z9", stateCode: "29" },
        ), // intra-state: CGST + SGST
      ],
      fy,
    );

    expect(register.totals.invoices).toBe(2);
    expect(register.totals.taxableMinor).toBe(2_00_000_00);
    expect(register.totals.igstMinor).toBe(18_000_00);
    expect(register.totals.cgstMinor).toBe(9_000_00);
    expect(register.totals.sgstMinor).toBe(9_000_00);
    expect(register.totals.totalMinor).toBe(2_36_000_00);
  });

  it("keeps only the chosen financial year", () => {
    const register = buildRegister([invoice()], financialYearOf("2024-05-10"));
    expect(register.totals.invoices).toBe(0);
    expect(register.outOfYear).toBe(1);
    expect(register.notes.join(" ")).toContain("outside this financial year");
  });

  it("puts a March invoice in the year that began the previous April", () => {
    const march = invoice({ invoiceDate: "2027-03-20" });
    const register = buildRegister([march], financialYearOf("2027-03-20"));
    expect(register.financialYear.label).toBe("2026-27");
    expect(register.totals.invoices).toBe(1);
  });

  it("flags a repeated invoice number, which breaks a consecutive series", () => {
    const register = buildRegister(
      [invoice(), invoice({ invoiceDate: "2026-06-10" })],
      financialYearOf("2026-05-10"),
    );
    expect(register.duplicateNumbers).toEqual(["INV-001"]);
    expect(register.notes.join(" ")).toContain("consecutive and unique");
  });

  it("groups by client and by month", () => {
    const register = buildRegister(
      [
        invoice(),
        invoice({ invoiceNumber: "INV-002", invoiceDate: "2026-06-11" }),
        invoice({ invoiceNumber: "INV-003", invoiceDate: "2026-06-12" }, { name: "Helios Labs", gstin: "" }),
      ],
      financialYearOf("2026-05-10"),
    );
    expect(register.byMonth.map((m) => m.month)).toEqual(["2026-05", "2026-06"]);
    expect(register.byClient).toHaveLength(2);
    expect(register.byClient[0]?.invoices).toBe(2);
  });

  it("says plainly that this is invoiced, not collected", () => {
    const register = buildRegister([invoice()], financialYearOf("2026-05-10"));
    expect(register.notes.join(" ")).toContain("not what you were paid");
    expect(register.notes.join(" ")).toContain("Only invoices generated here");
  });
});

describe("turnoverNote", () => {
  it("says nothing to someone who is registered", () => {
    expect(turnoverNote(50_00_000 * 100, true)).toBeNull();
  });

  it("says nothing well below the threshold", () => {
    expect(turnoverNote(5_00_000 * 100, false)).toBeNull();
  });

  it("warns as the threshold approaches, and frames it as a prompt", () => {
    const near = turnoverNote(17_00_000 * 100, false);
    expect(near).toContain("20%");
    expect(near).toContain("CA");
  });

  it("is explicit once past it, without claiming to have decided anything", () => {
    const past = turnoverNote(25_00_000 * 100, false);
    expect(past).toContain("₹20 lakh");
    expect(past).toContain("a prompt, not a determination");
  });
});

describe("POST /api/register", () => {
  async function makeInvoice(number: string, date: string): Promise<string> {
    const response = await invoiceRoute(
      jsonRequest("http://localhost/api/invoice", {
        supplier: { name: "Asha", gstin: "29ABCDE1234F1Z5" },
        client: { name: "Nimbus", gstin: "27ABCDE5678G1Z2", country: "India" },
        invoiceNumber: number,
        invoiceDate: date,
        items: [{ description: "Work", sacCode: "9983", quantity: 1, unitPrice: 100000 }],
        gstRatePct: 18,
      }),
    );
    return ((await response.json()) as { id: string }).id;
  }

  it("builds a register from stored invoices", async () => {
    const ids = [await makeInvoice("R-001", "2026-05-01"), await makeInvoice("R-002", "2026-06-01")];
    const response = await registerRoute(jsonRequest("http://localhost/api/register", { ids }));
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      register: { totals: { invoices: number; totalMinor: number } };
      availableYears: { label: string }[];
    };
    expect(body.register.totals.invoices).toBe(2);
    expect(body.register.totals.totalMinor).toBe(2_36_000_00);
    expect(body.availableYears.map((y) => y.label)).toContain("2026-27");
  });

  it("ignores artifacts that are not invoices", async () => {
    const invoiceId = await makeInvoice("R-010", "2026-05-01");
    const contract = await (
      await import("../app/api/contract/route.ts")
    ).POST(
      jsonRequest("http://localhost/api/contract", {
        freelancerName: "Asha",
        clientName: "Nimbus",
        scope: "Build a site.",
      }),
    );
    const contractId = ((await contract.json()) as { id: string }).id;

    const response = await registerRoute(
      jsonRequest("http://localhost/api/register", { ids: [invoiceId, contractId] }),
    );
    const body = (await response.json()) as { register: { totals: { invoices: number } } };
    expect(body.register.totals.invoices).toBe(1);
  });

  it("returns a workbook when asked", async () => {
    const ids = [await makeInvoice("R-020", "2026-05-01")];
    const response = await registerRoute(
      jsonRequest("http://localhost/api/register", { ids, format: "xlsx" }),
    );
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("rejects ids that are not ids", async () => {
    const response = await registerRoute(
      jsonRequest("http://localhost/api/register", { ids: ["../../etc/passwd", 7] }),
    );
    expect(response.status).toBe(404);
  });
});
