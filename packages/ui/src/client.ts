"use client";

import type { EventName } from "@probes/core/types.ts";

/**
 * Client-side event helper. Every probe's browser code calls exactly this.
 *
 * `keepalive` matters: `price_clicked` is usually followed by a navigation,
 * and without it the request is cancelled and the most important event in the
 * funnel silently disappears.
 */
export function trackClient(name: EventName, props: Record<string, unknown> = {}): void {
  try {
    const body = JSON.stringify({ name, props });
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never throw into a visitor's flow.
  }
}
