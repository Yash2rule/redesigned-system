import { getStore } from "@probes/core/server";
import type { DecodeResult } from "./analyse.ts";
import { MAX_COMPARE } from "./saved.ts";

/**
 * Side-by-side comparison of offers already decoded in this browser.
 *
 * Deliberately built on artifact ids rather than accounts: the whole portfolio
 * lets a stranger get a real result with no sign-up, and requiring one here
 * purely to compare two numbers would undo that. The browser remembers which
 * ids belong to it; the server just renders the ones it is handed.
 */

export { MAX_COMPARE } from "./saved.ts";

export type ComparisonRow = {
  label: string;
  /** One value per offer, already formatted. */
  values: string[];
  /** Index of the best offer on this row, or null when it does not rank. */
  bestIndex: number | null;
  /** Shown under the row when the ranking needs a caveat. */
  note?: string;
};

export type Comparison = {
  offers: { id: string; result: DecodeResult }[];
  rows: ComparisonRow[];
  /** Plain-language read of which offer wins on what. */
  verdict: string[];
  missingIds: string[];
};

export function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      seen.add(id.toLowerCase());
    }
    if (seen.size >= MAX_COMPARE) break;
  }
  return [...seen];
}

type Formatter = (minor: number) => string;

export async function buildComparison(
  ids: string[],
  formatInr: Formatter,
  formatShort: Formatter,
): Promise<Comparison> {
  const store = getStore();
  const offers: { id: string; result: DecodeResult }[] = [];
  const missingIds: string[] = [];

  for (const id of ids) {
    const artifact = await store.getArtifact(id);
    if (!artifact || artifact.probe !== "offer-decoder") {
      missingIds.push(id);
      continue;
    }
    offers.push({ id, result: artifact.payload as unknown as DecodeResult });
  }

  if (offers.length === 0) {
    return { offers, rows: [], verdict: [], missingIds };
  }

  const salaries = offers.map((offer) => offer.result.salary);

  /** Index of the highest value, or null if every offer ties. */
  const argMax = (values: number[]): number | null => {
    const best = Math.max(...values);
    if (values.every((v) => v === best)) return null;
    return values.indexOf(best);
  };
  const argMin = (values: number[]): number | null => {
    const best = Math.min(...values);
    if (values.every((v) => v === best)) return null;
    return values.indexOf(best);
  };

  const inHand = salaries.map((s) => s.monthlyInHand);
  const downside = salaries.map((s) => s.monthlyInHandDownside);
  const ctc = salaries.map((s) => s.ctc);
  const guaranteed = salaries.map((s) => s.guaranteedCashAnnual);
  const conditional = salaries.map((s) => s.conditionalPct);
  const nonCash = salaries.map((s) => s.nonCashPct);
  const tax = salaries.map((s) => s.best.tax.total);
  const flags = offers.map((o) => o.result.redFlags.length);
  const highFlags = offers.map(
    (o) => o.result.redFlags.filter((f) => f.severity === "high").length,
  );

  const rows: ComparisonRow[] = [
    {
      label: "Monthly in-hand",
      values: inHand.map(formatInr),
      bestIndex: argMax(inHand),
      note: "The number that reaches your bank each month. Usually the one that matters most.",
    },
    {
      label: "Monthly in-hand if variable underperforms",
      values: downside.map(formatInr),
      bestIndex: argMax(downside),
      note: "Same figure, with variable pay at the payout ratio you chose. An offer that wins on the row above and loses here is riskier than it looks.",
    },
    {
      label: "Headline CTC",
      values: ctc.map(formatShort),
      bestIndex: argMax(ctc),
      note: "Ranked because you asked, not because it means much on its own.",
    },
    {
      label: "Guaranteed cash a year",
      values: guaranteed.map(formatInr),
      bestIndex: argMax(guaranteed),
    },
    {
      label: "Conditional share of CTC",
      values: conditional.map((v) => `${v}%`),
      bestIndex: argMin(conditional),
      note: "Variable, ESOP and one-time bonuses. Lower is more certain, not necessarily better paid.",
    },
    {
      label: "Never reaches you as pay",
      values: nonCash.map((v) => `${v}%`),
      bestIndex: argMin(nonCash),
      note: "Employer PF, gratuity provision, insurance premium.",
    },
    {
      label: "Income tax for the year",
      values: tax.map(formatInr),
      bestIndex: argMin(tax),
      note: "Lower tax usually just means lower pay. Read this row with the first one.",
    },
    {
      label: "Clauses worth reading twice",
      values: flags.map((count, i) => `${count}${highFlags[i] ? ` (${highFlags[i]} high)` : ""}`),
      bestIndex: argMin(flags),
    },
  ];

  // --- verdict --------------------------------------------------------------
  const verdict: string[] = [];
  const name = (index: number) => `Offer ${index + 1}`;

  const bestInHand = argMax(inHand);
  const bestDownside = argMax(downside);

  if (bestInHand === null) {
    verdict.push("These offers pay the same in hand each month.");
  } else {
    const gap = inHand[bestInHand]! - Math.min(...inHand);
    verdict.push(
      `${name(bestInHand)} pays the most in hand — ${formatInr(gap)} a month more than the lowest here, or ${formatInr(gap * 12)} over a year.`,
    );
  }

  if (bestDownside !== null && bestInHand !== null && bestDownside !== bestInHand) {
    verdict.push(
      `But if variable pay underperforms, ${name(bestDownside)} comes out ahead instead. ${name(bestInHand)} is the better offer only if its variable actually pays.`,
    );
  }

  const worstFlags = argMax(highFlags);
  if (worstFlags !== null && highFlags[worstFlags]! > 0) {
    verdict.push(
      `${name(worstFlags)} has the most high-priority clauses (${highFlags[worstFlags]}). Read those before the money.`,
    );
  }

  const mostConditional = argMax(conditional);
  if (mostConditional !== null && conditional[mostConditional]! > 25) {
    verdict.push(
      `${name(mostConditional)} is ${conditional[mostConditional]}% conditional. A quarter of that package depends on something other than showing up.`,
    );
  }

  verdict.push(
    "None of this weighs the things we cannot see: the team, the manager, what you would learn, or whether the company will still be here in three years. Those usually matter more than the rows above.",
  );

  return { offers, rows, verdict, missingIds };
}
