/** The four probes running tonight. Every stored row is tagged with one. */
export const PROBES = ["offer-decoder", "ledger", "uptime", "freelancer-kit"] as const;
export type ProbeId = (typeof PROBES)[number];

export function isProbeId(value: unknown): value is ProbeId {
  return typeof value === "string" && (PROBES as readonly string[]).includes(value);
}

/**
 * Where an artifact is filed.
 *
 * Usually the probe that produced it. The extra scopes exist because
 * `listArtifacts` reads the newest N rows for a scope, and a scope holding two
 * unrelated kinds of row silently starves the rarer one: advance-tax reminders
 * shared "freelancer-kit" with every invoice and contract, so once 500 newer
 * documents existed the older reminders fell off the end of the scan and were
 * never sent. A reminder that quietly stops arriving is worse than one that was
 * never offered.
 *
 * These are storage buckets, not probes. `PROBES` still defines what the admin
 * dashboard reports on, so nothing here shows up as a fifth product.
 */
export const ARTIFACT_SCOPES = [...PROBES, "freelancer-kit-reminder"] as const;
export type ArtifactScope = (typeof ARTIFACT_SCOPES)[number];

/**
 * The seven funnel events, in order. The admin dashboard renders them as
 * columns in exactly this order, so the array is the source of truth for both
 * validation and layout.
 */
export const EVENT_NAMES = [
  "page_view",
  "upload_started",
  "result_viewed",
  "price_clicked",
  "checkout_started",
  "paid",
  "email_captured",
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type SessionRow = {
  id: string;
  probe: ProbeId;
  createdAt: string;
  userAgent: string | null;
  referrer: string | null;
};

export type EventRow = {
  id: string;
  sessionId: string;
  probe: ProbeId;
  name: EventName;
  props: Record<string, Json>;
  createdAt: string;
};

export type IntentRow = {
  id: string;
  sessionId: string;
  probe: ProbeId;
  email: string;
  plan: string;
  amountMinor: number;
  currency: "INR" | "USD";
  note: string | null;
  createdAt: string;
};

export type CorpusRow = {
  id: string;
  probe: ProbeId;
  kind: string;
  inputHash: string;
  input: Json;
  output: Json;
  createdAt: string;
};

/** A produced result, kept so a visitor can reopen it by URL. */
export type ArtifactRow = {
  id: string;
  probe: ArtifactScope;
  sessionId: string | null;
  payload: Json;
  createdAt: string;
};

export type ProbeDecision = "undecided" | "keep" | "kill";

export type ProbeStateRow = {
  probe: ProbeId;
  decision: ProbeDecision;
  note: string | null;
  updatedAt: string;
};

/** One probe's funnel, as the admin dashboard needs it. */
export type FunnelRow = {
  probe: ProbeId;
  sessions: number;
  counts: Record<EventName, number>;
  intents: number;
  intentValueMinor: number;
};

/**
 * An error whose message is safe and useful to show a visitor verbatim.
 *
 * The default in `runProbeFlow` is to swallow the real message and show a
 * generic apology, because parser stack traces are both useless and a little
 * frightening. Probes throw this when they have something specific and
 * actionable to say instead.
 */
export class UserFacingError extends Error {
  readonly userFacing = true;
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "UserFacingError";
    this.status = status;
  }
}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { userFacing?: unknown }).userFacing === true &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
