import type { Currency, ProbeId } from "@probes/core";

export type Plan = {
  id: string;
  name: string;
  /** Minor units: paise for INR, cents for USD. */
  amountMinor: number;
  currency: Currency;
  interval: "one_time" | "month" | "year";
  description: string;
  /** Sold as a bullet list on the pricing block. */
  features: string[];
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
