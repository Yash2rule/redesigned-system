export { env, capabilities } from "./env.ts";
export type { CapabilityReport } from "./env.ts";

export {
  EVENT_NAMES,
  PROBES,
  isEventName,
  isProbeId,
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

export { getStore, setStore, FileStore, PgStore, CREATE_TABLES_SQL } from "./store/index.ts";
export type { Store } from "./store/index.ts";

export { recordCorpus, redactText, redactValue } from "./corpus/index.ts";
export type { CorpusInput } from "./corpus/index.ts";

export {
  getLlmProvider,
  requireLlmProvider,
  setLlmProvider,
  hasLlm,
  LlmUnavailableError,
  AnthropicProvider,
  OpenAiProvider,
  GeminiProvider,
} from "./llm/index.ts";
export type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from "./llm/index.ts";

export { generateStructured, extractJson, z } from "./schema/index.ts";
export type { StructuredOptions, StructuredResult } from "./schema/index.ts";

export { ingestFile, ingestText, detectKind, MAX_UPLOAD_BYTES } from "./ingest/index.ts";
export type { IngestKind, IngestResult } from "./ingest/index.ts";

export { renderPdf, renderWorkbook } from "./render/index.ts";
export type {
  PdfDocumentSpec,
  PdfSection,
  SheetColumn,
  SheetSpec,
  WorkbookSpec,
} from "./render/index.ts";

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
  answerSupportQuestion,
  rankFaq,
  MIN_CONFIDENCE,
} from "./support/index.ts";
export type { FaqEntry, SupportAnswer, SupportOptions } from "./support/index.ts";

export {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  isValidSessionId,
  newSessionId,
  sessionCookieOptions,
} from "./session.ts";
export type { VisitorContext } from "./session.ts";
