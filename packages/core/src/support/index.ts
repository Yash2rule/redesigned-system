import { getLlmProvider } from "../llm/index.ts";

export type FaqEntry = {
  question: string;
  answer: string;
  /** Extra words that should match this entry but don't appear in the question. */
  keywords?: string[];
};

export type SupportAnswer = {
  answer: string;
  /** The FAQ entry it came from, or null when we declined to answer. */
  matched: string | null;
  confidence: number;
  source: "faq" | "llm" | "fallback";
};

const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","can","do","does","for","from","how","i","if",
  "in","is","it","its","me","my","of","on","or","that","the","this","to","was","what","when",
  "where","which","who","why","will","with","you","your","we","us","our","have","has","get",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** Overlap of query tokens with an entry, normalised by query length. */
function score(queryTokens: string[], entry: FaqEntry): number {
  if (queryTokens.length === 0) return 0;
  const target = new Set([
    ...tokenize(entry.question),
    ...tokenize(entry.answer).slice(0, 60),
    ...(entry.keywords ?? []).flatMap(tokenize),
  ]);
  let hits = 0;
  for (const token of new Set(queryTokens)) {
    if (target.has(token)) hits += 1;
    // Cheap stem match so "pricing" hits "price".
    else if ([...target].some((t) => t.startsWith(token.slice(0, 5)) && token.length >= 5)) {
      hits += 0.5;
    }
  }
  return hits / new Set(queryTokens).size;
}

export const MIN_CONFIDENCE = 0.34;

/** Rank FAQ entries against a question. Exported for tests and for the LLM path. */
export function rankFaq(question: string, faq: FaqEntry[]): { entry: FaqEntry; score: number }[] {
  const tokens = tokenize(question);
  return faq
    .map((entry) => ({ entry, score: score(tokens, entry) }))
    .sort((a, b) => b.score - a.score);
}

export type SupportOptions = {
  faq: FaqEntry[];
  /** Shown when we cannot answer. Must be a real, monitored address. */
  contactEmail: string;
  productName: string;
};

/**
 * Answer a support question from the probe's own FAQ.
 *
 * With no LLM key this is pure retrieval, and it says "I don't know" rather
 * than guessing. With a key, the model is used only to rephrase the retrieved
 * entries and is explicitly forbidden from adding facts — grounding beats
 * fluency for a support bot that speaks for a one-person company.
 */
export async function answerSupportQuestion(
  question: string,
  options: SupportOptions,
): Promise<SupportAnswer> {
  const trimmed = question.trim();
  const decline: SupportAnswer = {
    answer: `I don't have an answer to that in ${options.productName}'s FAQ, and I'd rather not guess. Email ${options.contactEmail} and a human will reply.`,
    matched: null,
    confidence: 0,
    source: "fallback",
  };
  if (trimmed.length < 3) return decline;

  const ranked = rankFaq(trimmed, options.faq);
  const best = ranked[0];
  if (!best || best.score < MIN_CONFIDENCE) return decline;

  const provider = getLlmProvider();
  if (!provider) {
    return {
      answer: best.entry.answer,
      matched: best.entry.question,
      confidence: Number(best.score.toFixed(2)),
      source: "faq",
    };
  }

  const context = ranked
    .slice(0, 3)
    .filter((r) => r.score > 0)
    .map((r) => `Q: ${r.entry.question}\nA: ${r.entry.answer}`)
    .join("\n\n");

  try {
    const response = await provider.complete({
      system: [
        `You answer support questions for ${options.productName}.`,
        "Use ONLY the FAQ entries provided. Do not add facts, features, prices, legal or tax claims.",
        `If the FAQ does not answer the question, reply with exactly: NO_ANSWER`,
        "Two or three sentences, plain language, no marketing.",
      ].join("\n"),
      messages: [{ role: "user", content: `FAQ:\n${context}\n\nQuestion: ${trimmed}` }],
      maxTokens: 300,
    });
    const text = response.text.trim();
    if (!text || text.includes("NO_ANSWER")) return decline;
    return {
      answer: text,
      matched: best.entry.question,
      confidence: Number(best.score.toFixed(2)),
      source: "llm",
    };
  } catch {
    // Model down or key invalid: the retrieved answer is still correct.
    return {
      answer: best.entry.answer,
      matched: best.entry.question,
      confidence: Number(best.score.toFixed(2)),
      source: "faq",
    };
  }
}
