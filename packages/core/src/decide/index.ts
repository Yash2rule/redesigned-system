import { PROBES } from "../types.ts";
import type { ProbeId } from "../types.ts";

/**
 * The rules that decide whether a probe lives, dies, or keeps running.
 *
 * Written as a pure function over funnel counts, so the reasoning can be
 * tested exhaustively without a database, a deployment, or a wait. Everything
 * that decides a probe's fate is in this file, and nothing else reads the
 * numbers to form an opinion about it.
 */

export type FunnelCounts = {
  /** Distinct visitors who landed. */
  landed: number;
  /** Distinct visitors who got a real result. */
  results: number;
  /** Distinct visitors who clicked a price. */
  pricesClicked: number;
  /** Distinct visitors who left an email against a named price. */
  emails: number;
  /** Distinct visitors who paid. Zero for everyone until a rail is live. */
  paid: number;
};

export type Verdict = "keep" | "kill" | "watch" | "insufficient-data";

export type Recommendation = {
  probe: ProbeId;
  verdict: Verdict;
  /** The rule that fired, in a sentence a human can argue with. */
  reason: string;
  metric: "intent-rate" | "paid-rate" | "none";
  metricPct: number | null;
  /** How much more traffic is needed before any verdict is possible. */
  needs: { landed: number; results: number } | null;
};

export type Thresholds = {
  /**
   * No verdict at all below these. The most important numbers in the file: a
   * rule applied to thirty visitors is not a decision, it is a coin toss
   * wearing a percentage sign, and stating it confidently makes it worse than
   * having no rule at all.
   */
  minLanded: number;
  minResults: number;
  /** Below this, demand is absent rather than merely weak. */
  killBelowPct: number;
  /** At or above this, the probe has earned more attention. */
  keepAbovePct: number;
  /**
   * Activation floor. Below this share of landers reaching a result, the
   * funnel is broken upstream — the page, the copy, the upload step — and the
   * intent rate is measuring the survivors of a bad experience rather than
   * demand for the thing. That is a bug report, not a verdict.
   */
  minActivationPct: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  minLanded: 100,
  minResults: 20,
  killBelowPct: 2,
  keepAbovePct: 8,
  minActivationPct: 10,
};

const pct = (numerator: number, denominator: number): number =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;

/**
 * Decide one probe's fate.
 *
 * Ranks on payment when a rail is live and on result-to-email before that,
 * which is the strongest honest signal available while every buy button only
 * records intent. The switch is automatic because the day a rail goes live is
 * the day the older metric stops being the best one available, and nobody
 * remembers to change a comparator by hand.
 */
export function recommend(
  probe: ProbeId,
  counts: FunnelCounts,
  paymentsLive: boolean,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Recommendation {
  const needs = {
    landed: Math.max(0, thresholds.minLanded - counts.landed),
    results: Math.max(0, thresholds.minResults - counts.results),
  };

  if (needs.landed > 0 || needs.results > 0) {
    return {
      probe,
      verdict: "insufficient-data",
      reason:
        `Not enough traffic to decide anything: ${counts.landed} landed and ${counts.results} got a result, ` +
        `against a floor of ${thresholds.minLanded} and ${thresholds.minResults}. ` +
        `A verdict from numbers this small would be noise with a percentage sign on it.`,
      metric: "none",
      metricPct: null,
      needs,
    };
  }

  const activation = pct(counts.results, counts.landed);
  if (activation < thresholds.minActivationPct) {
    return {
      probe,
      verdict: "watch",
      reason:
        `Only ${activation}% of visitors got as far as a result, under the ${thresholds.minActivationPct}% floor. ` +
        `Something upstream is losing people — the landing copy, the upload step, an error. ` +
        `Fix that before reading anything into what the survivors did.`,
      metric: "none",
      metricPct: null,
      needs: null,
    };
  }

  const metric = paymentsLive ? ("paid-rate" as const) : ("intent-rate" as const);
  const value = paymentsLive ? pct(counts.paid, counts.results) : pct(counts.emails, counts.results);
  const did = paymentsLive ? "paid" : "left an email against a named price";

  if (value < thresholds.killBelowPct) {
    return {
      probe,
      verdict: "kill",
      reason:
        `${value}% of the ${counts.results} people who got a real result ${did}, under the ` +
        `${thresholds.killBelowPct}% floor. They saw the thing work and did not want it at a price. ` +
        `That is the answer this probe was built to get.`,
      metric,
      metricPct: value,
      needs: null,
    };
  }

  if (value >= thresholds.keepAbovePct) {
    return {
      probe,
      verdict: "keep",
      reason:
        `${value}% of the ${counts.results} people who got a real result ${did}, at or above the ` +
        `${thresholds.keepAbovePct}% bar. This one has earned more of your attention than the others.`,
      metric,
      metricPct: value,
      needs: null,
    };
  }

  return {
    probe,
    verdict: "watch",
    reason:
      `${value}% ${did}, between the ${thresholds.killBelowPct}% and ${thresholds.keepAbovePct}% marks. ` +
      `Real, but not decisive either way. Keep collecting.`,
    metric,
    metricPct: value,
    needs: null,
  };
}

/**
 * Whether there are enough payments to judge a probe on them.
 *
 * One sale is not a payment rate. Switching the moment the first person pays
 * would take a probe doing well on intent and rule on it with a denominator of
 * one, which is the same mistake the sample floor exists to prevent, arriving
 * through a different door.
 */
export const MIN_PAID_TO_RANK_ON_PAYMENT = 5;

export function ranksOnPayment(
  counts: FunnelCounts,
  minPaid: number = MIN_PAID_TO_RANK_ON_PAYMENT,
): boolean {
  return counts.paid >= minPaid;
}

/** Every probe, strongest metric first, the undecidable ones last. */
export function recommendAll(
  counts: Record<ProbeId, FunnelCounts>,
  paymentsLive: Record<ProbeId, boolean>,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Recommendation[] {
  return PROBES.map((probe) =>
    recommend(probe, counts[probe], paymentsLive[probe] ?? false, thresholds),
  ).sort((a, b) => (b.metricPct ?? -1) - (a.metricPct ?? -1));
}
