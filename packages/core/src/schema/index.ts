import { z } from "zod";
import { getLlmProvider } from "../llm/index.ts";
import type { LlmRequest } from "../llm/types.ts";

/**
 * Pull the first JSON object or array out of a model response. Models wrap
 * JSON in prose and fences often enough that this is not optional.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((c): c is string => typeof c === "string");

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to bracket scanning
    }
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    const open = trimmed[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("No JSON value found in model response");
}

export type StructuredResult<T> =
  | { ok: true; data: T; attempts: number }
  | { ok: false; error: string; attempts: number };

export type StructuredOptions<T> = {
  schema: z.ZodType<T>;
  /** Human-readable description of the shape, injected into the prompt. */
  shapeHint: string;
  request: LlmRequest;
  /** How many repair rounds to allow after the first attempt. Default 1. */
  repairs?: number;
};

/**
 * Ask the model for JSON, validate it with zod, and on failure hand the model
 * its own output plus the validation errors and ask once more.
 *
 * Returns a result object rather than throwing: every caller in this repo has
 * a non-LLM fallback, and an exception would tempt callers to skip it.
 */
export async function generateStructured<T>(
  options: StructuredOptions<T>,
): Promise<StructuredResult<T>> {
  const provider = getLlmProvider();
  if (!provider) return { ok: false, error: "no-llm-provider", attempts: 0 };

  const system = [
    options.request.system ?? "",
    "",
    "Reply with a single JSON value and nothing else. No prose, no code fence.",
    `Required shape: ${options.shapeHint}`,
    "If you do not know a value, use null. Never invent a value to fill a field.",
  ]
    .join("\n")
    .trim();

  const messages = [...options.request.messages];
  const maxAttempts = 1 + (options.repairs ?? 1);
  let lastError = "unknown";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let raw = "";
    try {
      const response = await provider.complete({ ...options.request, system, messages });
      raw = response.text;
      const parsed = options.schema.safeParse(extractJson(raw));
      if (parsed.success) return { ok: true, data: parsed.data, attempts: attempt };
      lastError = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
    } catch (error) {
      lastError = (error as Error).message;
    }
    if (attempt < maxAttempts) {
      messages.push({ role: "assistant", content: raw.slice(0, 4000) });
      messages.push({
        role: "user",
        content: `That response did not validate: ${lastError}\nReturn corrected JSON only.`,
      });
    }
  }
  return { ok: false, error: lastError, attempts: maxAttempts };
}

export { z };
