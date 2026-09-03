import { handleDocument, num, str, toMinor } from "../../../lib/handlers.ts";
import { buildContract } from "../../../lib/contract.ts";
import type { ContractInput } from "../../../lib/contract.ts";

export const runtime = "nodejs";

function parse(body: unknown): ContractInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const structure = str(raw.feeStructure);
  return {
    freelancerName: str(raw.freelancerName, 120),
    freelancerAddress: str(raw.freelancerAddress, 300),
    clientName: str(raw.clientName, 120),
    clientAddress: str(raw.clientAddress, 300),
    scope: str(raw.scope, 3000),
    deliverables: str(raw.deliverables, 3000),
    feeMinor: toMinor(raw.fee),
    feeStructure:
      structure === "hourly" || structure === "monthly-retainer" ? structure : "fixed",
    rateMinor: toMinor(raw.rate),
    paymentTermsDays: num(raw.paymentTermsDays, 30),
    advancePct: num(raw.advancePct, 0),
    lateFeePctPerMonth: num(raw.lateFeePctPerMonth, 0),
    startDate: str(raw.startDate, 10),
    endDate: str(raw.endDate, 10),
    noticeDays: num(raw.noticeDays, 15),
    jurisdictionCity: str(raw.jurisdictionCity, 80),
    revisionRounds: num(raw.revisionRounds, 2),
    ipTransfersOnPayment: raw.ipTransfersOnPayment !== false,
    confidentialityMonths: num(raw.confidentialityMonths, 24),
  };
}

export async function POST(request: Request): Promise<Response> {
  return handleDocument(request, {
    kind: "contract",
    parse,
    build: buildContract,
    eventProps: (result) => ({ clauses: result.clauses.length }),
  });
}
