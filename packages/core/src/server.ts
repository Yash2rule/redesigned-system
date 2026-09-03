/**
 * Node-only barrel. Import this from route handlers, server components and
 * scripts; never from a client component or from `proxy.ts`.
 */

export * from "./index.ts";

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
export type { IngestKind, IngestResult, TextMode } from "./ingest/index.ts";

export { renderPdf, renderWorkbook } from "./render/index.ts";
export type {
  PdfDocumentSpec,
  PdfSection,
  SheetColumn,
  SheetSpec,
  WorkbookSpec,
} from "./render/index.ts";

export { answerSupportQuestion, rankFaq, MIN_CONFIDENCE } from "./support/index.ts";
export type { FaqEntry, SupportAnswer, SupportOptions } from "./support/index.ts";
