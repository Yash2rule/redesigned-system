import { getStore } from "@probes/core/server";
import type { SalaryResult } from "./salary.ts";

/**
 * Compare an offer against previously contributed, anonymised offers.
 *
 * The honesty rule that shapes this file: we only ever compare against real
 * rows in the corpus. On day one there are none, so the feature says so in
 * plain words rather than showing an invented benchmark. It becomes genuinely
 * useful once enough strangers have used the tool — which is precisely the
 * signal these probes exist to measure.
 */

/** Below this, a "benchmark" would be noise dressed up as data. */
export const MIN_SAMPLES_FOR_COMPARISON = 8;

export type BenchmarkResult =
  | {
      available: false;
      sampleCount: number;
      message: string;
    }
  | {
      available: true;
      sampleCount: number;
      /** Where this offer's CTC sits among contributed offers, 0-100. */
      ctcPercentile: number;
      medianCtc: number;
      /** Median share of CTC that is variable/ESOP/one-time, across the corpus. */
      medianConditionalPct: number;
      /** This offer's conditional share minus the median. */
      conditionalPctDelta: number;
      message: string;
    };

type CorpusOutput = {
  ctc?: unknown;
  conditionalPct?: unknown;
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
}

function percentileOf(value: number, population: number[]): number {
  if (population.length === 0) return 0;
  const below = population.filter((v) => v < value).length;
  return Math.round((below / population.length) * 100);
}

export async function benchmarkOffer(result: SalaryResult): Promise<BenchmarkResult> {
  let rows: Awaited<ReturnType<ReturnType<typeof getStore>["listCorpus"]>> = [];
  try {
    rows = await getStore().listCorpus("offer-decoder", "offer-letter", 2000);
  } catch {
    rows = [];
  }

  const samples = rows.flatMap((row) => {
    const output = row.output as CorpusOutput | null;
    const ctc = typeof output?.ctc === "number" ? output.ctc : null;
    const conditional = typeof output?.conditionalPct === "number" ? output.conditionalPct : 0;
    // Guard against parse failures polluting the benchmark.
    if (ctc === null || ctc < 100_000 * 100 || ctc > 100_000_000 * 100) return [];
    return [{ ctc, conditional }];
  });

  if (samples.length < MIN_SAMPLES_FOR_COMPARISON) {
    return {
      available: false,
      sampleCount: samples.length,
      message:
        samples.length === 0
          ? "Nobody has run an offer through this yet, so there is nothing to compare against. Yours will be the first — anonymised, with names, emails and account numbers stripped before anything is stored."
          : `Only ${samples.length} offer${samples.length === 1 ? " has" : "s have"} been run through this so far. We need at least ${MIN_SAMPLES_FOR_COMPARISON} before a comparison means anything, so we're not going to show you one yet.`,
    };
  }

  const ctcs = samples.map((s) => s.ctc);
  const conditionals = samples.map((s) => s.conditional);
  const percentile = percentileOf(result.ctc, ctcs);
  const medianConditional = median(conditionals.map((c) => Math.round(c * 100))) / 100;

  return {
    available: true,
    sampleCount: samples.length,
    ctcPercentile: percentile,
    medianCtc: median(ctcs),
    medianConditionalPct: medianConditional,
    conditionalPctDelta: Number((result.conditionalPct - medianConditional).toFixed(1)),
    message: `Compared against ${samples.length} offers contributed by other people using this tool. This is not a salary survey — it is only the offers that happened to pass through here, so read it as a rough signal.`,
  };
}
