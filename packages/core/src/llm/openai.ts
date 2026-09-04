import type { LlmProvider, LlmRequest, LlmResponse } from "./types.ts";

/**
 * Written against the REST API directly rather than the SDK: it is one fetch,
 * and it keeps the dependency tree (and the cold start) smaller.
 */
export class OpenAiProvider implements LlmProvider {
  readonly name = "openai";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini",
    baseUrl = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const messages = [
      ...(request.system ? [{ role: "system" as const, content: request.system }] : []),
      ...request.messages,
    ];
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return {
      text: body.choices?.[0]?.message?.content ?? "",
      provider: this.name,
      model: this.model,
    };
  }
}
