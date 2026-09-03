import { UserFacingError } from "@probes/core";
import { runProbeFlow } from "@probes/app-kit";
import { buildLedger } from "../../../lib/ledger.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return runProbeFlow(request, {
    probe: "ledger",
    kind: "bank-statement",
    textMode: "csv",
    analyse: (ingested) => {
      if (ingested.rows.length === 0) {
        throw new UserFacingError(
          "That didn't look like a CSV. Export your statement as CSV from your bank or UPI app and upload that — PDF statement layouts vary too much for us to read them without getting your numbers wrong.",
        );
      }
      return buildLedger(ingested.rows);
    },
    eventProps: (result) => ({
      transactions: result.totals.count,
      months: result.period.months,
      uncategorised: result.uncategorisedCount,
      money_in_minor: result.totals.moneyIn,
      money_out_minor: result.totals.moneyOut,
    }),
  });
}
