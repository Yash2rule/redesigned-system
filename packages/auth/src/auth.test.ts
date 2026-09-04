import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUTH_COOKIE, authAvailable, issueToken, verifyToken } from "./index.ts";

/**
 * Auth is optional in this portfolio, but a token scheme that is subtly wrong
 * is worse than none. These tests hold the two properties that matter: a token
 * cannot be forged, and it cannot be reused for a different purpose.
 */

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const key of ["AUTH_SECRET", "RESEND_API_KEY"]) saved[key] = process.env[key];
  process.env.AUTH_SECRET = "a-sufficiently-long-test-secret";
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("token round trip", () => {
  it("issues a token that verifies back to the email", () => {
    const token = issueToken("Asha@Example.com", "magic-link");
    expect(token).toBeTruthy();
    expect(verifyToken(token as string, "magic-link")?.email).toBe("asha@example.com");
  });

  it("issues a different token every time, even for the same email", () => {
    const a = issueToken("a@b.com", "magic-link");
    const b = issueToken("a@b.com", "magic-link");
    expect(a).not.toBe(b);
  });
});

describe("forgery resistance", () => {
  it("rejects a token whose signature has been altered", () => {
    const token = issueToken("a@b.com", "magic-link") as string;
    const parts = token.split(".");
    parts[4] = `${parts[4]?.slice(0, -1)}${parts[4]?.endsWith("A") ? "B" : "A"}`;
    expect(verifyToken(parts.join("."), "magic-link")).toBeNull();
  });

  it("rejects a token whose email has been swapped", () => {
    const token = issueToken("victim@example.com", "magic-link") as string;
    const parts = token.split(".");
    parts[1] = Buffer.from("attacker@example.com").toString("base64url");
    expect(verifyToken(parts.join("."), "magic-link")).toBeNull();
  });

  it("rejects a token whose expiry has been extended", () => {
    const token = issueToken("a@b.com", "magic-link") as string;
    const parts = token.split(".");
    parts[2] = String(Date.now() + 10 * 365 * 86_400_000);
    expect(verifyToken(parts.join("."), "magic-link")).toBeNull();
  });

  it("rejects a magic-link token presented as a session token", () => {
    // Purpose is inside the signed payload, so a short-lived sign-in link
    // cannot be replayed as a 30-day session.
    const token = issueToken("a@b.com", "magic-link") as string;
    expect(verifyToken(token, "session")).toBeNull();
    expect(verifyToken(token, "magic-link")).not.toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    for (const value of ["", "a.b.c", "....", "not-a-token", "a.b.c.d.e.f"]) {
      expect(() => verifyToken(value, "magic-link")).not.toThrow();
      expect(verifyToken(value, "magic-link")).toBeNull();
    }
  });

  it("rejects an already-expired token", () => {
    const token = issueToken("a@b.com", "magic-link") as string;
    const parts = token.split(".");
    parts[2] = String(Date.now() - 1000);
    expect(verifyToken(parts.join("."), "magic-link")).toBeNull();
  });
});

describe("when no secret is configured", () => {
  it("refuses to issue or verify rather than falling back to something weaker", () => {
    const token = issueToken("a@b.com", "magic-link") as string;
    delete process.env.AUTH_SECRET;
    expect(issueToken("a@b.com", "magic-link")).toBeNull();
    expect(verifyToken(token, "magic-link")).toBeNull();
  });

  it("refuses a secret that is too short to be worth anything", () => {
    process.env.AUTH_SECRET = "short";
    expect(issueToken("a@b.com", "magic-link")).toBeNull();
  });
});

describe("authAvailable", () => {
  it("needs both a secret and a way to send email", () => {
    delete process.env.RESEND_API_KEY;
    expect(authAvailable()).toBe(false);
    process.env.RESEND_API_KEY = "re_test";
    expect(authAvailable()).toBe(true);
    delete process.env.AUTH_SECRET;
    expect(authAvailable()).toBe(false);
  });
});

describe("cookie name", () => {
  it("is namespaced so it cannot collide with the session cookie", () => {
    expect(AUTH_COOKIE).toBe("probe_auth");
  });
});
