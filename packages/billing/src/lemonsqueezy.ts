import { env } from "@probes/core";
import type { BillingAdapter, CheckoutRequest, CheckoutResult } from "./types.ts";

/**
 * Lemon Squeezy acts as merchant of record, which is the reason it is here:
 * a solo Indian founder selling to US/EU businesses gets VAT/sales-tax
 * handling without registering anywhere.
 *
 * `plan.providerRef` must be the numeric variant id from the LS dashboard.
 */
export class LemonSqueezyAdapter implements BillingAdapter {
  readonly provider = "lemonsqueezy" as const;
  readonly currency = "USD" as const;

  isConfigured(): boolean {
    return Boolean(env.lemonSqueezyApiKey && env.lemonSqueezyStoreId);
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const apiKey = env.lemonSqueezyApiKey;
    const storeId = env.lemonSqueezyStoreId;
    if (!apiKey || !storeId) {
      return { mode: "error", message: "Lemon Squeezy is not configured" };
    }
    if (!request.plan.providerRef) {
      return {
        mode: "error",
        message: `Plan "${request.plan.id}" has no Lemon Squeezy variant id set.`,
      };
    }

    try {
      const res = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
        method: "POST",
        headers: {
          accept: "application/vnd.api+json",
          "content-type": "application/vnd.api+json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              checkout_data: {
                ...(request.email ? { email: request.email } : {}),
                custom: { probe: request.probe, session_id: request.sessionId },
              },
              ...(request.returnUrl
                ? { product_options: { redirect_url: request.returnUrl } }
                : {}),
            },
            relationships: {
              store: { data: { type: "stores", id: String(storeId) } },
              variant: { data: { type: "variants", id: String(request.plan.providerRef) } },
            },
          },
        }),
      });
      if (!res.ok) {
        return {
          mode: "error",
          message: `Lemon Squeezy rejected the request (${res.status}). Nothing was charged.`,
        };
      }
      const body = (await res.json()) as { data?: { attributes?: { url?: string } } };
      const url = body.data?.attributes?.url;
      if (!url) return { mode: "error", message: "Lemon Squeezy did not return a checkout URL." };
      return { mode: "checkout", url, provider: this.provider };
    } catch (error) {
      return {
        mode: "error",
        message: `Could not reach Lemon Squeezy (${(error as Error).message}). Nothing was charged.`,
      };
    }
  }
}
