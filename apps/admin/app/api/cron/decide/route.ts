import {
  PROBES,
  clearRetiredCache,
  getStore,
  ranksOnPayment,
  recommend,
} from "@probes/core/server";
import type { FunnelCounts, ProbeId, Recommendation } from "@probes/core/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/decide — read the funnel, apply the rules, record the verdict.
 *
 * The autonomous half of validation. It runs nightly, decides only what the
 * rules can decide from the sample it has, and stores the reasoning next to
 * the verdict so every decision can be argued with after the fact.
 *
 * Gated on CRON_SECRET like the other scheduled endpoints, and for a stronger
 * reason than they are: this one can switch a product off.
 */

/**
 * The marker separating a verdict this endpoint wrote from one a human made.
 * Automation may revise its own decisions freely and must never overwrite a
 * person's: someone who overrode a verdict from the dashboard has said
 * something, and having it silently reverted overnight would make the override
 * worthless and the dashboard untrustworthy.
 */
const AUTO_PREFIX = "[auto]";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  return (request.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

type Outcome = "applied" | "unchanged" | "left to the human who set it" | "dry run";

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json(
      {
        error:
          "This endpoint runs on a schedule and needs CRON_SECRET. It is not open, because it can retire a probe.",
      },
      { status: 401 },
    );
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const store = getStore();
  const funnels = await store.funnel();
  const states = await store.getProbeStates();

  const outcomes: { probe: ProbeId; recommendation: Recommendation; action: Outcome }[] = [];

  for (const probe of PROBES) {
    const row = funnels.find((f) => f.probe === probe);
    const counts: FunnelCounts = {
      landed: row?.counts.page_view ?? 0,
      results: row?.counts.result_viewed ?? 0,
      pricesClicked: row?.counts.price_clicked ?? 0,
      emails: row?.counts.email_captured ?? 0,
      paid: row?.counts.paid ?? 0,
    };
    const recommendation = recommend(probe, counts, ranksOnPayment(counts));
    const state = states.find((s) => s.probe === probe);

    // Only keep and kill are decisions. "watch" and "insufficient-data" are the
    // engine saying it does not know, and writing that to the switch would
    // discard whatever is already there in favour of nothing.
    if (recommendation.verdict !== "keep" && recommendation.verdict !== "kill") {
      outcomes.push({ probe, recommendation, action: "unchanged" });
      continue;
    }

    const humanOwned =
      state !== undefined && state.decision !== "undecided" && !state.note?.startsWith(AUTO_PREFIX);
    if (humanOwned) {
      outcomes.push({ probe, recommendation, action: "left to the human who set it" });
      continue;
    }

    if (state?.decision === recommendation.verdict && state.note?.startsWith(AUTO_PREFIX)) {
      outcomes.push({ probe, recommendation, action: "unchanged" });
      continue;
    }

    if (dryRun) {
      outcomes.push({ probe, recommendation, action: "dry run" });
      continue;
    }

    await store.setProbeDecision(
      probe,
      recommendation.verdict,
      `${AUTO_PREFIX} ${new Date().toISOString().slice(0, 10)} — ${recommendation.reason}`,
    );
    outcomes.push({ probe, recommendation, action: "applied" });
  }

  // A verdict just written must be visible to the probe apps on their next
  // request rather than up to a minute later.
  clearRetiredCache();

  const changed = outcomes.filter((o) => o.action === "applied");
  console.log(
    `[decide] ${outcomes.length} probes considered, ${changed.length} changed: ` +
      (changed.map((c) => `${c.probe}=${c.recommendation.verdict}`).join(", ") || "none"),
  );

  return Response.json(
    {
      ranAt: new Date().toISOString(),
      dryRun,
      considered: outcomes.length,
      changed: changed.length,
      probes: outcomes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
