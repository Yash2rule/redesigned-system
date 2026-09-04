import type { ProbeId } from "@probes/core/types.ts";
import type { Currency } from "@probes/core/money.ts";

export type Plan = {
  id: string;
  name: string;
  /** Minor units: paise for INR, cents for USD. */
  amountMinor: number;
  currency: Currency;
  interval: "one_time" | "month" | "year";
  description: string;
  /** Things this plan gives you that work today. */
  features: string[];
  /**
   * Things this plan will give you that are NOT built yet.
   *
   * Rendered separately and labelled, never mixed in with `features`. A
   * pricing page that lists a feature the product does not have is the same
   * lie as a buy button that does not charge — and it poisons the same signal,
   * because you cannot tell whether someone clicked for what exists or for
   * what was promised.
   */
  planned?: string[];
  highlight?: boolean;
  /** Razorpay Payment Link / Plan id, or Lemon Squeezy variant id. */
  providerRef?: string;
};

export type CheckoutRequest = {
  probe: ProbeId;
  plan: Plan;
  sessionId: string;
  email?: string;
  /** Where the provider should send the visitor back to. */
  returnUrl?: string;
  note?: string;
};

export type CheckoutResult =
  /** A real payment page exists. Redirect the visitor here. */
  | { mode: "checkout"; url: string; provider: "razorpay" | "lemonsqueezy" }
  /**
   * No payment keys configured. We recorded the visitor's intent and must now
   * tell them the truth: payments are not open yet.
   */
  | { mode: "intent"; message: string; recorded: boolean }
  | { mode: "error"; message: string };

export interface BillingAdapter {
  readonly provider: "razorpay" | "lemonsqueezy";
  readonly currency: Currency;
  isConfigured(): boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
}
