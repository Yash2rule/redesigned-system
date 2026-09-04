export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
  temperature?: number;
};

export type LlmResponse = { text: string; provider: string; model: string };

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * Thrown when a probe asks for LLM enrichment and no key is configured.
 * Callers are expected to catch this and degrade, never to surface it.
 */
export class LlmUnavailableError extends Error {
  constructor(message = "No LLM provider is configured") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}
