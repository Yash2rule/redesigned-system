import { randomUUID } from "node:crypto";
import { env, getStore } from "@probes/core";
import type { EventName, Json, ProbeId, SessionRow } from "@probes/core";

export type TrackInput = {
  probe: ProbeId;
  sessionId: string;
  name: EventName;
  props?: Record<string, Json>;
};

/**
 * The single event helper for every probe.
 *
 * Writes to the store unconditionally — that is what the admin dashboard
 * reads, and it must work with zero third-party keys — and additionally
 * mirrors to PostHog when POSTHOG_KEY exists.
 *
 * Never throws. A dropped analytics event must never break a visitor's flow;
 * a validation probe that 500s because its telemetry is down measures nothing.
 */
export async function track(input: TrackInput): Promise<void> {
  const createdAt = new Date().toISOString();
  const props = input.props ?? {};

  try {
    await getStore().recordEvent({
      id: randomUUID(),
      sessionId: input.sessionId,
      probe: input.probe,
      name: input.name,
      props,
      createdAt,
    });
  } catch (error) {
    console.warn("[analytics] store write failed:", (error as Error).message);
  }

  const key = env.posthogKey;
  if (!key) return;
  try {
    // PostHog's public capture endpoint: one fetch, no SDK, no batching
    // process to keep alive in a serverless function.
    await fetch(`${env.posthogHost.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: input.name,
        distinct_id: input.sessionId,
        timestamp: createdAt,
        properties: { ...props, probe: input.probe, $lib: "probes-analytics" },
      }),
    });
  } catch (error) {
    console.warn("[analytics] posthog mirror failed:", (error as Error).message);
  }
}

/** Register a visitor session before its first event. Idempotent. */
export async function ensureSession(row: SessionRow): Promise<void> {
  try {
    await getStore().ensureSession(row);
  } catch (error) {
    console.warn("[analytics] session write failed:", (error as Error).message);
  }
}

/** Where a probe's client-side events POST to. Same path in every app. */
export const TRACK_ENDPOINT = "/api/track";
