import { runProbeFlow } from "@probes/app-kit";
import { decodeOffer, readOptions } from "../../../lib/analyse.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return runProbeFlow(request, {
    probe: "offer-decoder",
    kind: "offer-letter",
    textMode: "text",
    analyse: (ingested, form) => decodeOffer(ingested, readOptions(form)),
    eventProps: (result) => ({
      ctc_minor: result.salary.ctc,
      conditional_pct: result.salary.conditionalPct,
      red_flags: result.redFlags.length,
      regime: result.salary.best.regime,
    }),
  });
}
