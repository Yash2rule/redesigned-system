import { createHash, randomUUID } from "node:crypto";
import { getStore } from "../store/index.ts";
import type { Json, ProbeId } from "../types.ts";
import { redactValue } from "./redact.ts";

export { redactText, redactValue } from "./redact.ts";
export type { RedactionResult } from "./redact.ts";

export type CorpusInput = {
  probe: ProbeId;
  /** What kind of run this was, e.g. "offer-letter" or "hdfc-csv". */
  kind: string;
  input: unknown;
  output: unknown;
};

/**
 * Record one anonymised input/output pair. Called on every successful run of
 * every probe — this is the data moat, and it starts on day one.
 *
 * Never throws: a corpus write failing must not fail a visitor's result.
 */
export async function recordCorpus(entry: CorpusInput): Promise<void> {
  try {
    const input = redactValue(entry.input) as Json;
    const output = redactValue(entry.output) as Json;
    const inputHash = createHash("sha256")
      .update(JSON.stringify(input) ?? "")
      .digest("hex");
    await getStore().saveCorpus({
      id: randomUUID(),
      probe: entry.probe,
      kind: entry.kind,
      inputHash,
      input,
      output,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[corpus] write failed, continuing:", (error as Error).message);
  }
}
