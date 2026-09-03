import type {
  ArtifactRow,
  CorpusRow,
  EventRow,
  FunnelRow,
  IntentRow,
  ProbeDecision,
  ProbeId,
  ProbeStateRow,
  SessionRow,
} from "../types.ts";

/**
 * The whole persistence surface of the portfolio. Deliberately narrow: two
 * implementations have to stay in lockstep, so every method here must be
 * cheap to write twice.
 */
export interface Store {
  readonly kind: "postgres" | "file";

  ensureSession(row: SessionRow): Promise<void>;
  recordEvent(row: EventRow): Promise<void>;
  saveIntent(row: IntentRow): Promise<void>;
  saveCorpus(row: CorpusRow): Promise<void>;

  saveArtifact(row: ArtifactRow): Promise<void>;
  getArtifact(id: string): Promise<ArtifactRow | null>;

  getProbeStates(): Promise<ProbeStateRow[]>;
  setProbeDecision(probe: ProbeId, decision: ProbeDecision, note: string | null): Promise<void>;

  /** Funnel counts per probe, for the admin dashboard. */
  funnel(): Promise<FunnelRow[]>;
  /** Most recent intents across all probes, newest first. */
  recentIntents(limit: number): Promise<IntentRow[]>;
  /** Corpus size per probe — the "data moat" counter. */
  corpusCounts(): Promise<Record<string, number>>;
}
