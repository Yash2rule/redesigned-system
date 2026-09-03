import { handleDocument, num, str, toMinor } from "../../../lib/handlers.ts";
import { computeAdvanceTax } from "../../../lib/advance-tax.ts";
import type { AdvanceTaxInput } from "../../../lib/advance-tax.ts";

export const runtime = "nodejs";

function parse(body: unknown): AdvanceTaxInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  return {
    grossReceiptsMinor: toMinor(raw.grossReceipts),
    expensesMinor: toMinor(raw.expenses),
    otherIncomeMinor: toMinor(raw.otherIncome),
    basis: str(raw.basis) === "actual-books" ? "actual-books" : "presumptive-44ada",
    regime: str(raw.regime) === "old" ? "old" : "new",
    deductionsMinor: toMinor(raw.deductions),
    tdsDeductedMinor: toMinor(raw.tdsDeducted),
    alreadyPaidMinor: toMinor(raw.alreadyPaid),
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleDocument(request, {
    kind: "advance-tax",
    parse,
    build: (input) => computeAdvanceTax(input),
    eventProps: (result) => ({
      basis: result.basis,
      liability_minor: result.liabilityAfterTdsMinor,
      advance_due: result.advanceTaxDue,
    }),
  });
}
