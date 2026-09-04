import { env } from "@probes/core";
import type { BillingAdapter, CheckoutRequest, CheckoutResult } from "./types.ts";

/**
 * Razorpay Payment Links: one authenticated POST returns a hosted checkout
 * URL. Chosen over Orders + Checkout.js because it needs no client-side SDK,
 * no signature verification on the happy path, and no PCI surface at all.
 */
export class RazorpayAdapter implements BillingAdapter {
  readonly provider = "razorpay" as const;
  readonly currency = "INR" as const;

  isConfigured(): boolean {
    return Boolean(env.razorpayKeyId && env.razorpayKeySecret);
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const keyId = env.razorpayKeyId;
    const keySecret = env.razorpayKeySecret;
    if (!keyId || !keySecret) {
      return { mode: "error", message: "Razorpay is not configured" };
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    try {
      const res = await fetch("https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${auth}` },
        body: JSON.stringify({
          amount: request.plan.amountMinor,
          currency: "INR",
          description: `${request.plan.name} — ${request.probe}`,
          ...(request.email ? { customer: { email: request.email }, notify: { email: true } } : {}),
          reminder_enable: false,
          notes: {
            probe: request.probe,
            plan: request.plan.id,
            session_id: request.sessionId,
          },
          ...(request.returnUrl
            ? { callback_url: request.returnUrl, callback_method: "get" }
            : {}),
        }),
      });
      if (!res.ok) {
        return {
          mode: "error",
          message: `Razorpay rejected the request (${res.status}). Nothing was charged.`,
        };
      }
      const body = (await res.json()) as { short_url?: string };
      if (!body.short_url) {
        return { mode: "error", message: "Razorpay did not return a payment link." };
      }
      return { mode: "checkout", url: body.short_url, provider: this.provider };
    } catch (error) {
      return {
        mode: "error",
        message: `Could not reach Razorpay (${(error as Error).message}). Nothing was charged.`,
      };
    }
  }
}
