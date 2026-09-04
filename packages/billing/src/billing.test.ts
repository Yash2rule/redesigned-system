import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStore, setStore, getStore } from "@probes/core/store/index.ts";
import {
  EARLY_ACCESS_CONFIRMATION,
  EARLY_ACCESS_LABEL,
  adapterFor,
  createCheckout,
  isValidEmail,
  paymentsLive,
} from "./index.ts";
import type { Plan } from "./types.ts";

/**
 * These tests exist to protect one promise: with no payment keys, the product
 * says so and records intent. It never pretends a payment is happening. That
 * is the single behaviour the whole validation exercise depends on being true.
 */

const inrPlan: Plan = {
  id: "compare",
  name: "Compare five",
  amountMinor: 49_900,
  currency: "INR",
  interval: "one_time",
  description: "Five reports",
  features: [],
};

const usdPlan: Plan = { ...inrPlan, id: "agency", currency: "USD", amountMinor: 7_900 };

let dir: string;
const KEYS = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "LEMONSQUEEZY_API_KEY",
  "LEMONSQUEEZY_STORE_ID",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "billing-"));
  setStore(new FileStore(dir));
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  setStore(null);
  rmSync(dir, { recursive: true, force: true });
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("with no payment keys", () => {
  it("reports that payments are not live for either currency", () => {
    expect(paymentsLive("INR")).toBe(false);
    expect(paymentsLive("USD")).toBe(false);
  });

  it("records the intent and says plainly that nothing was charged", async () => {
    const result = await createCheckout({
      probe: "offer-decoder",
      plan: inrPlan,
      sessionId: "s1",
      email: "someone@example.com",
    });

    expect(result.mode).toBe("intent");
    if (result.mode !== "intent") throw new Error("unreachable");
    expect(result.recorded).toBe(true);
    expect(result.message).toBe(EARLY_ACCESS_CONFIRMATION);
    expect(result.message).toContain("haven't been charged");

    const intents = await getStore().recentIntents(10);
    expect(intents).toHaveLength(1);
    expect(intents[0]?.email).toBe("someone@example.com");
    expect(intents[0]?.plan).toBe("compare");
    expect(intents[0]?.amountMinor).toBe(49_900);
    expect(intents[0]?.probe).toBe("offer-decoder");
  });

  it("never returns a checkout URL", async () => {
    for (const plan of [inrPlan, usdPlan]) {
      const result = await createCheckout({
        probe: "uptime",
        plan,
        sessionId: "s1",
        email: "a@b.com",
      });
      expect(result.mode).not.toBe("checkout");
      expect(JSON.stringify(result)).not.toContain("http");
    }
  });

  it("asks for an email rather than silently doing nothing", async () => {
    const result = await createCheckout({ probe: "ledger", plan: inrPlan, sessionId: "s1" });
    expect(result.mode).toBe("intent");
    if (result.mode !== "intent") throw new Error("unreachable");
    expect(result.recorded).toBe(false);
    expect(result.message).toContain("email");
  });

  it("normalises the stored email so duplicates are visible", async () => {
    await createCheckout({
      probe: "ledger",
      plan: inrPlan,
      sessionId: "s1",
      email: "  Mixed.Case@Example.COM  ",
    });
    expect((await getStore().recentIntents(1))[0]?.email).toBe("mixed.case@example.com");
  });

  it("has a button label that states the situation", () => {
    expect(EARLY_ACCESS_LABEL).toContain("payments open");
    expect(EARLY_ACCESS_LABEL.toLowerCase()).not.toContain("buy now");
  });
});

describe("rail selection", () => {
  it("sends rupees to Razorpay and dollars to Lemon Squeezy", () => {
    expect(adapterFor("INR").provider).toBe("razorpay");
    expect(adapterFor("USD").provider).toBe("lemonsqueezy");
  });

  it("only reports a rail live when BOTH of its keys are present", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_x";
    expect(paymentsLive("INR")).toBe(false);
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(paymentsLive("INR")).toBe(true);
  });

  it("refuses a Lemon Squeezy plan with no variant id, rather than half-charging", async () => {
    process.env.LEMONSQUEEZY_API_KEY = "ls_x";
    process.env.LEMONSQUEEZY_STORE_ID = "1234";
    const result = await createCheckout({
      probe: "uptime",
      plan: usdPlan, // no providerRef
      sessionId: "s1",
      email: "a@b.com",
    });
    expect(result.mode).toBe("error");
    if (result.mode !== "error") throw new Error("unreachable");
    expect(result.message).toContain("variant id");
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    for (const email of ["a@b.co", "first.last+tag@sub.example.com", "x_y@example.in"]) {
      expect(isValidEmail(email), email).toBe(true);
    }
  });

  it("rejects the usual nonsense", () => {
    for (const email of ["", "notanemail", "a@b", "a b@c.com", "@example.com", "a@.com", null, 42]) {
      expect(isValidEmail(email), String(email)).toBe(false);
    }
  });

  it("rejects an absurdly long address", () => {
    expect(isValidEmail(`${"a".repeat(300)}@example.com`)).toBe(false);
  });
});
