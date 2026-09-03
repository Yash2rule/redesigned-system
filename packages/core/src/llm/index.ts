import { env } from "../env.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAiProvider } from "./openai.ts";
import { LlmUnavailableError } from "./types.ts";
import type { LlmProvider } from "./types.ts";

export { AnthropicProvider } from "./anthropic.ts";
export { OpenAiProvider } from "./openai.ts";
export { GeminiProvider } from "./gemini.ts";
export { LlmUnavailableError } from "./types.ts";
export type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from "./types.ts";

let override: LlmProvider | null = null;

/** Tests inject a deterministic provider here. */
export function setLlmProvider(provider: LlmProvider | null): void {
  override = provider;
}

/**
 * Anthropic first (per the brief), then OpenAI, then Gemini, unless
 * LLM_PROVIDER names one explicitly. Returns null rather than throwing so
 * callers are forced to think about the no-key path.
 */
export function getLlmProvider(): LlmProvider | null {
  if (override) return override;
  const preferred = env.llmProvider?.toLowerCase();
  const candidates: [string, () => LlmProvider | null][] = [
    ["anthropic", () => (env.anthropicApiKey ? new AnthropicProvider(env.anthropicApiKey) : null)],
    ["openai", () => (env.openaiApiKey ? new OpenAiProvider(env.openaiApiKey) : null)],
    ["gemini", () => (env.geminiApiKey ? new GeminiProvider(env.geminiApiKey) : null)],
  ];
  if (preferred) {
    const match = candidates.find(([name]) => name === preferred);
    return match ? match[1]() : null;
  }
  for (const [, build] of candidates) {
    const provider = build();
    if (provider) return provider;
  }
  return null;
}

export function requireLlmProvider(): LlmProvider {
  const provider = getLlmProvider();
  if (!provider) throw new LlmUnavailableError();
  return provider;
}

export function hasLlm(): boolean {
  return getLlmProvider() !== null;
}
