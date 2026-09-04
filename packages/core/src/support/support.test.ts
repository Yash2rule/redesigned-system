import { afterEach, describe, expect, it } from "vitest";
import { setLlmProvider } from "../llm/index.ts";
import type { LlmProvider } from "../llm/types.ts";
import { MIN_CONFIDENCE, answerSupportQuestion, rankFaq } from "./index.ts";
import type { FaqEntry } from "./index.ts";

/**
 * The support widget speaks for a one-person company. Its promise is that it
 * answers from the FAQ or says it does not know — it never improvises a
 * refund policy, a price, or a tax claim. These tests hold it to that.
 */

const faq: FaqEntry[] = [
  {
    question: "What happens to my offer letter?",
    answer:
      "The text is used to produce your result. An anonymised copy is stored; names, emails and account numbers are replaced with tokens first.",
    keywords: ["privacy", "data", "store", "delete"],
  },
  {
    question: "What does it cost?",
    answer: "Your first offer is free. After that it is ₹199 for a single report.",
    keywords: ["price", "pricing", "free", "subscription"],
  },
  {
    question: "Can it read a PDF or a photo?",
    answer: "PDFs with selectable text, yes. Scans and photos, no — we do not run OCR.",
    keywords: ["pdf", "image", "scan", "ocr", "upload"],
  },
];

const options = { faq, contactEmail: "hello@example.com", productName: "Offer Decoder" };

afterEach(() => setLlmProvider(null));

describe("with no LLM configured", () => {
  it("returns the FAQ answer verbatim when one matches", async () => {
    const result = await answerSupportQuestion("what do you do with my data", options);
    expect(result.source).toBe("faq");
    expect(result.answer).toBe(faq[0]?.answer);
    expect(result.matched).toBe(faq[0]?.question);
  });

  it("answers a pricing question from the pricing entry", async () => {
    const result = await answerSupportQuestion("how much does this cost", options);
    expect(result.matched).toBe("What does it cost?");
  });

  it("says it does not know rather than guessing", async () => {
    const result = await answerSupportQuestion(
      "which mutual fund should I invest my bonus in",
      options,
    );
    expect(result.source).toBe("fallback");
    expect(result.matched).toBeNull();
    expect(result.answer).toContain("don't have an answer");
    expect(result.answer).toContain("hello@example.com");
  });

  it("declines an empty or trivial question", async () => {
    for (const question of ["", "  ", "hi"]) {
      expect((await answerSupportQuestion(question, options)).source).toBe("fallback");
    }
  });

  it("never invents a number that is not in the FAQ", async () => {
    const result = await answerSupportQuestion("do you offer a 50% student discount", options);
    expect(result.answer).not.toContain("50%");
    expect(result.answer).not.toContain("student");
  });
});

describe("rankFaq", () => {
  it("puts the most relevant entry first", () => {
    expect(rankFaq("can you read a scanned pdf", faq)[0]?.entry.question).toBe(
      "Can it read a PDF or a photo?",
    );
  });

  it("scores an unrelated question below the answer threshold", () => {
    const [best] = rankFaq("what is the capital of France", faq);
    expect(best?.score ?? 0).toBeLessThan(MIN_CONFIDENCE);
  });
});

describe("with an LLM configured", () => {
  const provider = (reply: string, seen: { prompt?: string } = {}): LlmProvider => ({
    name: "stub",
    model: "stub-1",
    async complete(request) {
      seen.prompt = `${request.system ?? ""}\n${request.messages.map((m) => m.content).join("\n")}`;
      return { text: reply, provider: "stub", model: "stub-1" };
    },
  });

  it("uses the model to rephrase, and grounds it in the retrieved entries", async () => {
    const seen: { prompt?: string } = {};
    setLlmProvider(provider("We store an anonymised copy with identifiers removed.", seen));

    const result = await answerSupportQuestion("what do you do with my data", options);
    expect(result.source).toBe("llm");
    expect(result.answer).toContain("anonymised");
    // The FAQ text must actually be in the prompt, and the model must be told
    // it may not add anything.
    expect(seen.prompt).toContain("anonymised copy is stored");
    expect(seen.prompt).toContain("Do not add facts");
    expect(seen.prompt).toContain("NO_ANSWER");
  });

  it("honours the model's NO_ANSWER signal", async () => {
    setLlmProvider(provider("NO_ANSWER"));
    const result = await answerSupportQuestion("what do you do with my data", options);
    expect(result.source).toBe("fallback");
    expect(result.answer).toContain("hello@example.com");
  });

  it("never reaches the model for a question the FAQ does not cover", async () => {
    let called = false;
    setLlmProvider({
      name: "stub",
      model: "stub-1",
      async complete() {
        called = true;
        return { text: "I can help with that!", provider: "stub", model: "stub-1" };
      },
    });
    const result = await answerSupportQuestion("recommend me a tax saving scheme", options);
    expect(called).toBe(false);
    expect(result.source).toBe("fallback");
  });

  it("falls back to the retrieved answer when the model errors", async () => {
    setLlmProvider({
      name: "stub",
      model: "stub-1",
      async complete() {
        throw new Error("503 from provider");
      },
    });
    const result = await answerSupportQuestion("what do you do with my data", options);
    expect(result.source).toBe("faq");
    expect(result.answer).toBe(faq[0]?.answer);
  });
});
