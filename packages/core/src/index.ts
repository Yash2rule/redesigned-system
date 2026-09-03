/**
 * Client-safe barrel.
 *
 * This entry point deliberately exports ONLY modules that can be bundled for
 * the browser and the edge runtime: types, environment reads, money
 * formatting, session helpers, and the Indian tax/statutory tables.
 *
 * The node-only parts — the store (Postgres driver, fs), document ingestion
 * (pdf.js), rendering (pdfkit, exceljs), the LLM providers, the corpus writer
 * and the support engine — are reachable at their own subpaths:
 *
 *   @probes/core/store/index.ts
 *   @probes/core/ingest/index.ts
 *   @probes/core/render/index.ts
 *   @probes/core/llm/index.ts
 *   @probes/core/schema/index.ts
 *   @probes/core/support/index.ts
 *   @probes/core/corpus/index.ts
 *
 * Keeping them out of the barrel is what stops a client component that wants
 * `formatInr` from dragging the Postgres driver into the browser bundle. The
 * failure mode when they were exported here was a build error several layers
 * deep in an import trace, so the boundary is enforced by structure rather
 * than by remembering.
 */

export { env, capabilities } from "./env.ts";
export type { CapabilityReport } from "./env.ts";

export {
  EVENT_NAMES,
  PROBES,
  UserFacingError,
  isEventName,
  isProbeId,
  isUserFacingError,
} from "./types.ts";
export type {
  ArtifactRow,
  CorpusRow,
  EventName,
  EventRow,
  FunnelRow,
  IntentRow,
  Json,
  ProbeDecision,
  ProbeId,
  ProbeStateRow,
  SessionRow,
} from "./types.ts";

export {
  formatInr,
  formatUsd,
  formatMoney,
  formatIndianShort,
  parseIndianAmount,
  rupees,
  fromPaise,
} from "./money.ts";
export type { Currency } from "./money.ts";

export {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  isValidSessionId,
  newSessionId,
  sessionCookieOptions,
} from "./session.ts";
export type { VisitorContext } from "./session.ts";

export * as india from "./india/index.ts";
