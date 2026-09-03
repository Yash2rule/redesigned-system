import { afterEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  resetRateLimits,
} from "./rate-limit.ts";

afterEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  it("allows up to the limit and then refuses", () => {
    const rule = { limit: 3, windowMs: 60_000 };
    for (let i = 0; i < 3; i += 1) {
      expect(checkRateLimit("k", rule).ok, `call ${i + 1}`).toBe(true);
    }
    expect(checkRateLimit("k", rule).ok).toBe(false);
  });

  it("counts down remaining and never goes negative", () => {
    const rule = { limit: 2, windowMs: 60_000 };
    expect(checkRateLimit("k", rule).remaining).toBe(1);
    expect(checkRateLimit("k", rule).remaining).toBe(0);
    expect(checkRateLimit("k", rule).remaining).toBe(0);
  });

  it("keeps separate keys separate", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit("a", rule).ok).toBe(true);
    expect(checkRateLimit("b", rule).ok).toBe(true);
    expect(checkRateLimit("a", rule).ok).toBe(false);
  });

  it("lets the window expire", async () => {
    const rule = { limit: 1, windowMs: 30 };
    expect(checkRateLimit("k", rule).ok).toBe(true);
    expect(checkRateLimit("k", rule).ok).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(checkRateLimit("k", rule).ok).toBe(true);
  });

  it("reports a retry-after of at least one second", () => {
    const result = checkRateLimit("k", { limit: 0, windowMs: 100 });
    expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("rateLimitKey", () => {
  it("keys on the first forwarded IP", () => {
    const request = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(rateLimitKey(request, "sess-1", "uptime")).toBe("uptime:ip:1.2.3.4");
  });

  it("ignores the session when an IP is known", () => {
    // Otherwise dropping the cookie resets the budget, which a script does by
    // default because it never had one.
    const headers = { "x-forwarded-for": "1.2.3.4" };
    const a = rateLimitKey(new Request("http://x/", { headers }), "sess-1", "uptime");
    const b = rateLimitKey(new Request("http://x/", { headers }), "sess-2", "uptime");
    expect(a).toBe(b);
  });

  it("falls back to the session only when there is no IP at all", () => {
    expect(rateLimitKey(new Request("http://x/"), "sess-1", "uptime")).toBe(
      "uptime:session:sess-1",
    );
  });

  it("separates scopes, so one probe cannot exhaust another's budget", () => {
    const request = new Request("http://x/");
    expect(rateLimitKey(request, "s", "ledger")).not.toBe(rateLimitKey(request, "s", "uptime"));
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 with the headers a client needs to back off", async () => {
    const result = checkRateLimit("k", { limit: 0, windowMs: 60_000 });
    const response = rateLimitedResponse(result, "Slow down.");

    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(response.headers.get("x-ratelimit-limit")).toBe("0");
    // States plainly that the limit is per-instance rather than global.
    expect(response.headers.get("x-ratelimit-scope")).toBe("per-instance");
    expect((await response.json()) as unknown).toEqual({ error: "Slow down." });
  });
});
