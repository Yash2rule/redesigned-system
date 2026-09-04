/**
 * Every environment variable this monorepo reads, in one place.
 *
 * Rule enforced here: nothing is required. Each probe must produce its full
 * result with an entirely empty environment, because that is the state the
 * repo ships in and the state it will be demoed in. Missing keys downgrade a
 * feature and are reported honestly to the visitor; they never throw.
 */

const read = (key: string): string | undefined => {
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

export const env = {
  /** Postgres connection string. Absent -> FileStore. */
  get databaseUrl() {
    return read("DATABASE_URL");
  },
  /** Where FileStore keeps its JSON/JSONL. Absent -> <repo>/.data */
  get dataDir() {
    return read("DATA_DIR");
  },
  get anthropicApiKey() {
    return read("ANTHROPIC_API_KEY");
  },
  get openaiApiKey() {
    return read("OPENAI_API_KEY");
  },
  get geminiApiKey() {
    return read("GEMINI_API_KEY");
  },
  /** "anthropic" | "openai" | "gemini". Absent -> first provider with a key. */
  get llmProvider() {
    return read("LLM_PROVIDER");
  },
  get posthogKey() {
    return read("POSTHOG_KEY");
  },
  get posthogHost() {
    return read("POSTHOG_HOST") ?? "https://app.posthog.com";
  },
  get razorpayKeyId() {
    return read("RAZORPAY_KEY_ID");
  },
  get razorpayKeySecret() {
    return read("RAZORPAY_KEY_SECRET");
  },
  get lemonSqueezyApiKey() {
    return read("LEMONSQUEEZY_API_KEY");
  },
  get lemonSqueezyStoreId() {
    return read("LEMONSQUEEZY_STORE_ID");
  },
  get resendApiKey() {
    return read("RESEND_API_KEY");
  },
  get adminPassword() {
    return read("ADMIN_PASSWORD");
  },
  get appBaseUrl() {
    return read("APP_BASE_URL");
  },
} as const;

export type CapabilityReport = {
  database: boolean;
  llm: boolean;
  analytics: boolean;
  paymentsInr: boolean;
  paymentsUsd: boolean;
  email: boolean;
};

/** What this deployment can actually do right now. Rendered in /api/health. */
export function capabilities(): CapabilityReport {
  return {
    database: Boolean(env.databaseUrl),
    llm: Boolean(env.anthropicApiKey || env.openaiApiKey || env.geminiApiKey),
    analytics: Boolean(env.posthogKey),
    paymentsInr: Boolean(env.razorpayKeyId && env.razorpayKeySecret),
    paymentsUsd: Boolean(env.lemonSqueezyApiKey && env.lemonSqueezyStoreId),
    email: Boolean(env.resendApiKey),
  };
}
