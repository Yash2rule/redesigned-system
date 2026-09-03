/**
 * Generate a realistic spread of sessions and events across all four probes,
 * so the admin dashboard can be looked at before any real traffic arrives.
 *
 * Writes ONLY to the store the environment points at. Run it against a scratch
 * DATA_DIR, never against production: the dashboard exists to show real
 * behaviour, and seeded rows in there would be a lie told to yourself, which
 * is the expensive kind.
 *
 *   DATA_DIR=./.data-demo pnpm seed
 */

import { randomUUID } from "node:crypto";
import { EVENT_NAMES, PROBES, getStore } from "@probes/core/server";
import type { EventName, ProbeId } from "@probes/core/server";

const PLANS: Record<ProbeId, { id: string; amountMinor: number; currency: "INR" | "USD" }[]> = {
  "offer-decoder": [
    { id: "single", amountMinor: 19900, currency: "INR" },
    { id: "compare", amountMinor: 49900, currency: "INR" },
  ],
  ledger: [
    { id: "single", amountMinor: 14900, currency: "INR" },
    { id: "monthly", amountMinor: 39900, currency: "INR" },
  ],
  uptime: [
    { id: "studio", amountMinor: 2900, currency: "USD" },
    { id: "agency", amountMinor: 7900, currency: "USD" },
  ],
  "freelancer-kit": [
    { id: "monthly", amountMinor: 29900, currency: "INR" },
    { id: "yearly", amountMinor: 249900, currency: "INR" },
  ],
};

/** Deliberately different shapes, so the dashboard has something to rank. */
const PROFILE: Record<ProbeId, { sessions: number; activation: number; intent: number }> = {
  "offer-decoder": { sessions: 140, activation: 0.62, intent: 0.14 },
  ledger: { sessions: 95, activation: 0.48, intent: 0.09 },
  uptime: { sessions: 120, activation: 0.71, intent: 0.05 },
  "freelancer-kit": { sessions: 80, activation: 0.4, intent: 0.11 },
};

// Deterministic PRNG so a reseed produces the same picture.
let seed = 1337;
const random = (): number => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

async function main(): Promise<void> {
  const store = getStore();
  const now = Date.now();
  let events = 0;
  let intents = 0;

  for (const probe of PROBES) {
    const profile = PROFILE[probe];
    for (let i = 0; i < profile.sessions; i += 1) {
      const sessionId = randomUUID();
      const createdAt = new Date(now - Math.floor(random() * 21 * 86_400_000)).toISOString();

      await store.ensureSession({
        id: sessionId,
        probe,
        createdAt,
        userAgent: "seed-script",
        referrer: null,
      });

      const reached: EventName[] = ["page_view"];
      if (random() < profile.activation) {
        reached.push("upload_started", "result_viewed");
        if (random() < 0.4) reached.push("price_clicked");
        if (reached.includes("price_clicked") && random() < profile.intent / 0.4) {
          reached.push("checkout_started", "email_captured");
        }
      } else if (random() < 0.25) {
        reached.push("upload_started");
      }

      for (const name of reached) {
        await store.recordEvent({
          id: randomUUID(),
          sessionId,
          probe,
          name,
          props: {},
          createdAt,
        });
        events += 1;
      }

      if (reached.includes("email_captured")) {
        const plans = PLANS[probe];
        const plan = plans[Math.floor(random() * plans.length)] ?? plans[0];
        if (plan) {
          await store.saveIntent({
            id: randomUUID(),
            sessionId,
            probe,
            email: `visitor${i}@example.com`,
            plan: plan.id,
            amountMinor: plan.amountMinor,
            currency: plan.currency,
            note: null,
            createdAt,
          });
          intents += 1;
        }
      }
    }
  }

  console.log(
    `Seeded ${PROBES.length} probes: ${events} events, ${intents} intents across ${EVENT_NAMES.length} event types.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
