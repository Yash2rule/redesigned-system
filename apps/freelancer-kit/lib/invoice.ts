import { UserFacingError, india } from "@probes/core";

/**
 * GST invoice generation for Indian freelancers.
 *
 * Follows the particulars Rule 46 of the CGST Rules requires on a tax
 * invoice. Two things this deliberately gets right, because getting them
 * wrong is the single most common freelancer mistake:
 *
 * 1. Intra-state supply splits into CGST + SGST at half the rate each;
 *    inter-state is a single IGST at the full rate. The split is decided by
 *    comparing the supplier's state with the place of supply, not by anything
 *    the user types.
 * 2. Someone who is not GST-registered must not charge GST at all. Asking for
 *    it on an invoice with no GSTIN is collecting tax you have no authority to
 *    collect. So an unregistered supplier gets a plain invoice with a note
 *    saying exactly that, and the tax fields are absent rather than zeroed.
 */

export type LineItem = {
  description: string;
  /** SAC for services, HSN for goods. Required on a tax invoice. */
  sacCode: string;
  quantity: number;
  unitPriceMinor: number;
};

export type InvoiceInput = {
  supplier: {
    name: string;
    address: string;
    gstin: string;
    /** GST state code. Derived from the GSTIN when one is given. */
    stateCode: string;
    email: string;
    phone: string;
    pan: string;
  };
  client: {
    name: string;
    address: string;
    gstin: string;
    /** Place of supply. For services this is normally the client's state. */
    stateCode: string;
    country: string;
  };
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  items: LineItem[];
  /** 0, 5, 12, 18 or 28. Ignored when the supplier is not registered. */
  gstRatePct: number;
  /** Export of services under a Letter of Undertaking: zero-rated, no IGST. */
  exportUnderLut: boolean;
  notes: string;
  /** Percent per month charged on overdue amounts. */
  lateFeePctPerMonth: number;
};

export type TaxLine = { label: string; ratePct: number; amountMinor: number };

export type InvoiceResult = {
  input: InvoiceInput;
  registered: boolean;
  /** "tax-invoice" | "invoice" (unregistered) | "export-invoice" */
  documentType: "tax-invoice" | "invoice" | "export-invoice";
  documentTitle: string;
  supplyType: "intra-state" | "inter-state" | "export" | "not-applicable";
  placeOfSupply: string;
  subtotalMinor: number;
  taxLines: TaxLine[];
  totalTaxMinor: number;
  totalMinor: number;
  totalInWords: string;
  /** Statements that must appear on the document. */
  declarations: string[];
  /** Things the user should check before sending. */
  warnings: string[];
};

const GST_RATES = [0, 5, 12, 18, 28];

/** Rule 46(b): up to 16 characters, alphanumeric with / and - only. */
const INVOICE_NUMBER_RE = /^[A-Za-z0-9/-]{1,16}$/;

function required(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) throw new UserFacingError(`${field} is required on an invoice.`, 400);
  return trimmed;
}

export function buildInvoice(input: InvoiceInput): InvoiceResult {
  const warnings: string[] = [];
  const declarations: string[] = [];

  required(input.supplier.name, "Your name or business name");
  required(input.client.name, "The client's name");

  if (!INVOICE_NUMBER_RE.test(input.invoiceNumber.trim())) {
    throw new UserFacingError(
      "An invoice number can be at most 16 characters and may only contain letters, digits, / and -. That is a GST rule, not ours.",
      400,
    );
  }
  if (input.items.length === 0) {
    throw new UserFacingError("Add at least one line item.", 400);
  }

  const supplierGstin = input.supplier.gstin.trim().toUpperCase();
  const clientGstin = input.client.gstin.trim().toUpperCase();
  const registered = supplierGstin.length > 0;

  if (registered && !india.isValidGstinShape(supplierGstin)) {
    throw new UserFacingError(
      `"${supplierGstin}" is not shaped like a GSTIN. It should be 15 characters: two state digits, your PAN, an entity digit, Z, and a check character.`,
      400,
    );
  }
  if (clientGstin && !india.isValidGstinShape(clientGstin)) {
    warnings.push(
      `The client GSTIN "${clientGstin}" is not shaped like a valid GSTIN. Check it before sending — a wrong GSTIN on your invoice can block their input tax credit.`,
    );
  }

  const supplierState = registered
    ? (india.stateCodeFromGstin(supplierGstin) ?? input.supplier.stateCode)
    : input.supplier.stateCode;
  const clientState = clientGstin
    ? (india.stateCodeFromGstin(clientGstin) ?? input.client.stateCode)
    : input.client.stateCode;

  const isExport =
    input.client.country.trim().length > 0 &&
    input.client.country.trim().toLowerCase() !== "india";

  const subtotalMinor = input.items.reduce(
    (sum, item) => sum + Math.round(item.quantity * item.unitPriceMinor),
    0,
  );

  // --- tax ------------------------------------------------------------------
  const taxLines: TaxLine[] = [];
  let supplyType: InvoiceResult["supplyType"] = "not-applicable";
  let documentType: InvoiceResult["documentType"] = "invoice";
  let documentTitle = "Invoice";

  if (!registered) {
    documentType = "invoice";
    documentTitle = "Invoice";
    declarations.push(
      "The supplier is not registered under GST, so no GST is charged on this invoice.",
    );
    warnings.push(
      "You have not entered a GSTIN, so this invoice charges no GST — which is correct if you are not registered. Registration becomes compulsory once turnover crosses ₹20 lakh a year for services (₹10 lakh in some special-category states), and is compulsory from the first rupee for inter-state supply of services in some cases. Check with a CA where you stand.",
    );
    if (input.gstRatePct > 0) {
      warnings.push(
        "You picked a GST rate but gave no GSTIN. We have not added the tax: charging GST without being registered means collecting a tax you have no authority to collect.",
      );
    }
  } else if (isExport) {
    supplyType = "export";
    documentType = "export-invoice";
    documentTitle = "Export Invoice";
    if (input.exportUnderLut) {
      declarations.push(
        "Supply meant for export of services under a Letter of Undertaking without payment of integrated tax.",
      );
      warnings.push(
        "Exporting under LUT requires a valid LUT filed for the current financial year. It does not carry over — it must be filed again each year.",
      );
    } else {
      taxLines.push({
        label: "IGST",
        ratePct: input.gstRatePct,
        amountMinor: Math.round((subtotalMinor * input.gstRatePct) / 100),
      });
      declarations.push("Export of services with payment of integrated tax, refund claimed.");
    }
    warnings.push(
      "For export of services to be zero-rated, payment must be received in convertible foreign exchange (or INR where the RBI permits it), and the recipient must be outside India. Keep the FIRC or bank advice.",
    );
  } else if (!GST_RATES.includes(input.gstRatePct)) {
    throw new UserFacingError(
      `${input.gstRatePct}% is not a GST rate. The rates are 0, 5, 12, 18 and 28 percent; most professional services are 18.`,
      400,
    );
  } else {
    documentType = "tax-invoice";
    documentTitle = "Tax Invoice";
    const intraState = supplierState === clientState && supplierState.length > 0;
    supplyType = intraState ? "intra-state" : "inter-state";

    if (intraState) {
      const half = input.gstRatePct / 2;
      // Split the rounding so CGST + SGST always equals the total tax exactly.
      const total = Math.round((subtotalMinor * input.gstRatePct) / 100);
      const cgst = Math.round(total / 2);
      taxLines.push(
        { label: "CGST", ratePct: half, amountMinor: cgst },
        { label: "SGST", ratePct: half, amountMinor: total - cgst },
      );
    } else {
      taxLines.push({
        label: "IGST",
        ratePct: input.gstRatePct,
        amountMinor: Math.round((subtotalMinor * input.gstRatePct) / 100),
      });
      if (!clientState) {
        warnings.push(
          "No client state was given, so this has been treated as an inter-state supply and charged IGST. If the client is in your own state it should be CGST + SGST instead — set their state to fix it.",
        );
      }
    }

    if (!clientGstin) {
      declarations.push("The recipient is not registered under GST.");
      if (subtotalMinor > 50_000 * 100) {
        warnings.push(
          "For a supply above ₹50,000 to an unregistered recipient, the invoice must also carry their address and the place of supply with the state name. Both are on this invoice — check they are right.",
        );
      }
    }
  }

  const missingSac = input.items.filter((item) => !item.sacCode.trim());
  if (registered && missingSac.length > 0) {
    warnings.push(
      `${missingSac.length} line item${missingSac.length === 1 ? " has" : "s have"} no SAC code. A tax invoice needs one per line — for most freelance professional and technical services it is 9983 or 9987, but check the correct code for what you actually do.`,
    );
  }

  declarations.push("Tax is not payable on reverse charge basis for this supply.");
  declarations.push(
    "This is a computer-generated document. It is valid without a physical signature.",
  );

  const totalTaxMinor = taxLines.reduce((sum, line) => sum + line.amountMinor, 0);
  const totalMinor = subtotalMinor + totalTaxMinor;

  return {
    input: {
      ...input,
      supplier: { ...input.supplier, gstin: supplierGstin, stateCode: supplierState },
      client: { ...input.client, gstin: clientGstin, stateCode: clientState },
    },
    registered,
    documentType,
    documentTitle,
    supplyType,
    placeOfSupply: isExport
      ? `${input.client.country.trim()} (outside India)`
      : `${india.gstStateName(clientState) ?? "not specified"}${clientState ? ` (${clientState})` : ""}`,
    subtotalMinor,
    taxLines,
    totalTaxMinor,
    totalMinor,
    totalInWords: india.amountInWords(totalMinor),
    declarations,
    warnings,
  };
}
