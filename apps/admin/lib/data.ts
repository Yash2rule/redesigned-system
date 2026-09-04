import { EVENT_NAMES, PROBES, getStore } from "@probes/core/server";
import type { EventName, FunnelRow, IntentRow, ProbeDecision, ProbeId } from "@probes/core/server";

/**
 * The comparison the whole portfolio exists to produce: the same funnel for
 * every probe, side by side, so ranking them is reading a table rather than
 * having an opinion.
 */

export const PROBE_LABELS: Record<ProbeId, string> = {
  "offer-decoder": "Offer Decoder",
  ledger: "Statement to Ledger",
  uptime: "Client Watch",
  "freelancer-kit": "Freelance Desk",
};

export const PROBE_CURRENCY: Record<ProbeId, "INR" | "USD"> = {
  "offer-decoder": "INR",
  ledger: "INR",
  uptime: "USD",
  "freelancer-kit": "INR",
};

export const EVENT_LABELS: Record<EventName, string> = {
  page_view: "Landed",
  upload_started: "Started",
  result_viewed: "Got a result",
  price_clicked: "Clicked a price",
  checkout_started: "Began checkout",
  paid: "Paid",
  email_captured: "Left an email",
};

export type ProbeRow = {
  probe: ProbeId;
  label: string;
  currency: "INR" | "USD";
  decision: ProbeDecision;
  note: string | null;
  funnel: FunnelRow;
  corpusRows: number;
  /** Percentage of landers who reached each step. */
  conversion: Record<EventName, number>;
  /**
   * The ranking metric. With no payment rail live, "paid" reads zero for
   * everyone, so the strongest honest signal is the share of people who saw a
   * result and then handed over an email against a named price.
   */
  intentRatePct: number;
  /** Share of landers who got as far as a real result. */
  activationRatePct: number;
};

export type Dashboard = {
  rows: ProbeRow[];
  recentIntents: IntentRow[];
  storeKind: "postgres" | "file";
  totals: { sessions: number; results: number; intents: number };
  generatedAt: string;
};

const pct = (numerator: number, denominator: number): number =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;

export async function loadDashboard(): Promise<Dashboard> {
  const store = getStore();
  // Sequential, not Promise.all, and that is not an oversight.
  //
  // These four reads in parallel put four concurrent demands on a connection
  // pool of three, against a shared pooler. Run that way the page failed
  // almost every time while the identical four calls, made one after another,
  // returned in about twenty-five milliseconds together — measured against
  // the live database, from the same deployment, on the same data. Whatever
  // the contention is, it costs more than the parallelism ever saved: these
  // are four small aggregates, and doing them in turn is imperceptible.
  const funnels = await store.funnel();
  const states = await store.getProbeStates();
  const corpus = await store.corpusCounts();
  const recentIntents = await store.recentIntents(40);

  const rows: ProbeRow[] = PROBES.map((probe) => {
    const funnel =
      funnels.find((f) => f.probe === probe) ??
      ({
        probe,
        sessions: 0,
        counts: Object.fromEntries(EVENT_NAMES.map((n) => [n, 0])) as Record<EventName, number>,
        intents: 0,
        intentValueMinor: 0,
      } satisfies FunnelRow);
    const state = states.find((s) => s.probe === probe);
    const landed = funnel.counts.page_view;

    return {
      probe,
      label: PROBE_LABELS[probe],
      currency: PROBE_CURRENCY[probe],
      decision: state?.decision ?? "undecided",
      note: state?.note ?? null,
      funnel,
      corpusRows: corpus[probe] ?? 0,
      conversion: Object.fromEntries(
        EVENT_NAMES.map((name) => [name, pct(funnel.counts[name], landed)]),
      ) as Record<EventName, number>,
      intentRatePct: pct(funnel.counts.email_captured, funnel.counts.result_viewed),
      activationRatePct: pct(funnel.counts.result_viewed, landed),
    };
  });

  return {
    rows,
    recentIntents,
    storeKind: store.kind,
    totals: {
      sessions: rows.reduce((sum, row) => sum + row.funnel.sessions, 0),
      results: rows.reduce((sum, row) => sum + row.funnel.counts.result_viewed, 0),
      intents: rows.reduce((sum, row) => sum + row.funnel.intents, 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
