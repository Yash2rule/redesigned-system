import { describe, expect, it } from "vitest";
import { config as offerDecoder } from "../apps/offer-decoder/lib/config.ts";
import { config as ledger } from "../apps/ledger/lib/config.ts";
import { config as uptime } from "../apps/uptime/lib/config.ts";
import { config as freelancerKit } from "../apps/freelancer-kit/lib/config.ts";
import type { ProbeConfig } from "@probes/ui";

/**
 * A pricing page that lists a feature the product does not have is the same
 * lie as a buy button that does not charge, and it poisons the same signal:
 * you cannot tell whether someone clicked for what exists or for what was
 * promised.
 *
 * An audit found six such claims across the four probes. These tests are the
 * guard rail that stops them coming back — anything not built goes in
 * `planned`, which the pricing block renders under "Not built yet".
 */

const CONFIGS: ProbeConfig[] = [offerDecoder, ledger, uptime, freelancerKit];

/** Phrases that describe capabilities this codebase does not have. */
const NOT_BUILT = [
  /\bemail(ed)?\b.*\b(report|alert|reminder|summary)\b/i,
  /\b(report|alert|reminder)\b.*\bemail(ed)?\b/i,
  /\bsaved\b.*\b(client|details|defaults)\b/i,
  /\b(remember|remembers)\b.*\bdefaults?\b/i,
  /\boverride\b.*\bsave\b/i,
  /\brollup\b/i,
  /\bregister for your CA\b/i,
  /\byear-end\b/i,
  /\byour own domain\b/i,
  /\bhourly\b/i,
  /\blogo\b/i,
];

describe.each(CONFIGS.map((c) => [c.id, c] as const))("%s pricing", (_id, config) => {
  it("has at least one plan, each with a real price and at least one working feature", () => {
    expect(config.plans.length).toBeGreaterThan(0);
    for (const plan of config.plans) {
      expect(plan.amountMinor, plan.id).toBeGreaterThan(0);
      expect(plan.features.length, plan.id).toBeGreaterThan(0);
    }
  });

  it("never lists an unbuilt capability as a working feature", () => {
    for (const plan of config.plans) {
      for (const feature of plan.features) {
        for (const pattern of NOT_BUILT) {
          expect(
            pattern.test(feature),
            `"${config.name}" plan "${plan.id}" claims "${feature}" as built, but it matches ${pattern}. Move it to \`planned\`.`,
          ).toBe(false);
        }
      }
    }
  });

  it("keeps planned items out of the working list", () => {
    for (const plan of config.plans) {
      const overlap = (plan.planned ?? []).filter((item) => plan.features.includes(item));
      expect(overlap, `${plan.id} lists the same item as both built and planned`).toEqual([]);
    }
  });

  it("states a disclaimer that limits rather than promises", () => {
    expect(config.disclaimer.length).toBeGreaterThan(80);

    // It must actually disclaim something — "not advice", "not a guarantee".
    // The bare word "guarantee" is fine and expected: the uptime disclaimer
    // uses it to deny one.
    expect(config.disclaimer, config.id).toMatch(
      /\bnot\b[^.]{0,80}\b(advice|a guarantee|evidence)\b/i,
    );

    // What it must never do is promise one.
    expect(config.disclaimer, config.id).not.toMatch(/\bwe guarantee\b|\bguaranteed to\b/i);
  });

  it("answers eight questions in the FAQ", () => {
    expect(config.faq.length).toBeGreaterThanOrEqual(8);
    for (const item of config.faq) {
      expect(item.answer.length, item.question).toBeGreaterThan(40);
    }
  });

  it("gives a contact address that appears in the disclaimer flow", () => {
    expect(config.contactEmail).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });
});

describe("the whole portfolio", () => {
  it("covers four distinct probes with distinct accents", () => {
    expect(new Set(CONFIGS.map((c) => c.id)).size).toBe(4);
    expect(new Set(CONFIGS.map((c) => c.accent)).size).toBe(4);
  });

  it("prices in exactly one currency per probe", () => {
    for (const config of CONFIGS) {
      expect(new Set(config.plans.map((p) => p.currency)).size, config.id).toBe(1);
    }
  });
});
