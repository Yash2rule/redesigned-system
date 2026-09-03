import { handleDocument, num, str, toMinor } from "../../../lib/handlers.ts";
import { buildInvoice } from "../../../lib/invoice.ts";
import type { InvoiceInput, LineItem } from "../../../lib/invoice.ts";

export const runtime = "nodejs";

function parse(body: unknown): InvoiceInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const supplier = (raw.supplier ?? {}) as Record<string, unknown>;
  const client = (raw.client ?? {}) as Record<string, unknown>;
  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    supplier: {
      name: str(supplier.name, 120),
      address: str(supplier.address, 400),
      gstin: str(supplier.gstin, 20),
      stateCode: str(supplier.stateCode, 2),
      email: str(supplier.email, 120),
      phone: str(supplier.phone, 20),
      pan: str(supplier.pan, 10),
    },
    client: {
      name: str(client.name, 120),
      address: str(client.address, 400),
      gstin: str(client.gstin, 20),
      stateCode: str(client.stateCode, 2),
      country: str(client.country, 60) || "India",
    },
    invoiceNumber: str(raw.invoiceNumber, 20),
    invoiceDate: str(raw.invoiceDate, 10),
    dueDate: str(raw.dueDate, 10),
    items: items.slice(0, 40).map((entry): LineItem => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        description: str(item.description, 300),
        sacCode: str(item.sacCode, 10),
        quantity: num(item.quantity, 1),
        unitPriceMinor: toMinor(item.unitPrice),
      };
    }),
    gstRatePct: num(raw.gstRatePct, 18),
    exportUnderLut: raw.exportUnderLut === true,
    notes: str(raw.notes, 1000),
    lateFeePctPerMonth: num(raw.lateFeePctPerMonth, 0),
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleDocument(request, {
    kind: "invoice",
    parse,
    build: buildInvoice,
    eventProps: (result) => ({
      total_minor: result.totalMinor,
      supply_type: result.supplyType,
      registered: result.registered,
    }),
  });
}
