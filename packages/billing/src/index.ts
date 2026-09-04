import { randomUUID } from "node:crypto";
import { getStore } from "@probes/core/server";
import { LemonSqueezyAdapter } from "./lemonsqueezy.ts";
import { RazorpayAdapter } from "./razorpay.ts";
import type { BillingAdapter, CheckoutRequest, CheckoutResult, Plan } from "./types.ts";

export { RazorpayAdapter } from "./razorpay.ts";
export { LemonSqueezyAdapter } from "./lemonsqueezy.ts";
export type { BillingAdapter, CheckoutRequest, CheckoutResult, Plan } from "./types.ts";

const RAZORPAY = new RazorpayAdapter();
const LEMONSQUEEZY = new LemonSqueezyAdapter();

/** INR goes to Razorpay, USD to Lemon Squeezy. No configuration needed. */
export function adapterFor(currency: Plan["currency"]): BillingAdapter {
  return currency === "USD" ? LEMONSQUEEZY : RAZORPAY;
}

export function paymentsLive(currency: Plan["currency"]): boolean {
  return adapterFor(currency).isConfigured();
}

/**
 * The honest early-access message. Shown verbatim on the button and repeated
 * after the visitor leaves their email.
 *
 * The brief is explicit and correct about this: a button that pretends to
 * charge, or that silently does nothing, poisons the only signal these probes
 * exist to collect.
 */
export const EARLY_ACCESS_LABEL = "Join early access — payments open this week";

export const EARLY_ACCESS_CONFIRMATION =
  "Recorded. Payments aren't switched on yet, so you haven't been charged and there's nothing to cancel. " +
  "You'll get one email when they open — and nothing else.";

export type IntentCapture = {
  probe: CheckoutRequest["probe"];
  plan: Plan;
  sessionId: string;
  email: string;
  note?: string;
};

/** Record purchase intent: email + chosen plan + timestamp. */
export async function recordIntent(capture: IntentCapture): Promise<boolean> {
  try {
    await getStore().saveIntent({
      id: randomUUID(),
      sessionId: capture.sessionId,
      probe: capture.probe,
      email: capture.email.trim().toLowerCase(),
      plan: capture.plan.id,
      amountMinor: capture.plan.amountMinor,
      currency: capture.plan.currency,
      note: capture.note ?? null,
      createdAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("[billing] intent write failed:", (error as Error).message);
    return false;
  }
}

/**
 * The one entry point every probe calls.
 *
 * With provider keys: a real hosted checkout URL.
 * Without: the visitor's intent is recorded and they are told plainly that
 * payments are not open. There is no third branch where we pretend.
 */
export async function createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
  const adapter = adapterFor(request.plan.currency);

  if (!adapter.isConfigured()) {
    if (!request.email) {
      return {
        mode: "intent",
        message: "Leave your email and we'll tell you the day payments open.",
        recorded: false,
      };
    }
    const recorded = await recordIntent({
      probe: request.probe,
      plan: request.plan,
      sessionId: request.sessionId,
      email: request.email,
      note: request.note,
    });
    return { mode: "intent", message: EARLY_ACCESS_CONFIRMATION, recorded };
  }

  // Keys exist, so also keep the intent row: it is how the funnel connects a
  // price click to a payment when the webhook lands later.
  if (request.email) {
    await recordIntent({
      probe: request.probe,
      plan: request.plan,
      sessionId: request.sessionId,
      email: request.email,
      note: request.note,
    });
  }
  return adapter.createCheckout(request);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL_RE.test(value.trim());
}
