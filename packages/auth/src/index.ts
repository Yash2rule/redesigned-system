import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@probes/core";

/**
 * Magic-link auth, optional by design.
 *
 * Every probe must produce its first result with no account at all — asking a
 * stranger to sign up before they have seen anything destroys the funnel the
 * probes exist to measure. Auth only gates saved history.
 *
 * Implemented as a stateless signed token rather than Supabase Auth or
 * Auth.js: no extra table, no session store, no third-party dependency, and it
 * works identically with or without a database. The signing secret is derived
 * from AUTH_SECRET; with none set, signing is disabled and the whole feature
 * reports itself unavailable rather than falling back to something insecure.
 */

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string | null {
  const value = process.env.AUTH_SECRET?.trim();
  return value && value.length >= 16 ? value : null;
}

export function authAvailable(): boolean {
  return secret() !== null && Boolean(env.resendApiKey);
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export type TokenPurpose = "magic-link" | "session";

/** `<purpose>.<email-b64>.<expiry>.<nonce>.<sig>` */
export function issueToken(email: string, purpose: TokenPurpose): string | null {
  const key = secret();
  if (!key) return null;
  const ttl = purpose === "session" ? SESSION_TTL_MS : TOKEN_TTL_MS;
  const parts = [
    purpose,
    Buffer.from(email.trim().toLowerCase()).toString("base64url"),
    String(Date.now() + ttl),
    randomBytes(8).toString("base64url"),
  ];
  return [...parts, sign(parts.join("."), key)].join(".");
}

export type VerifiedToken = { email: string; purpose: TokenPurpose };

export function verifyToken(token: string, purpose: TokenPurpose): VerifiedToken | null {
  const key = secret();
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [tokenPurpose, emailPart, expiryPart, noncePart, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (tokenPurpose !== purpose) return null;
  if (!safeEqual(signature, sign([tokenPurpose, emailPart, expiryPart, noncePart].join("."), key))) {
    return null;
  }
  const expiry = Number(expiryPart);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return null;
  return { email: Buffer.from(emailPart, "base64url").toString("utf8"), purpose };
}

export const AUTH_COOKIE = "probe_auth";

/** Send the magic link. Returns false (and logs) when email is not configured. */
export async function sendMagicLink(email: string, link: string): Promise<boolean> {
  const apiKey = env.resendApiKey;
  if (!apiKey) {
    console.warn("[auth] RESEND_API_KEY missing; magic link not sent");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.AUTH_FROM_EMAIL?.trim() || "login@example.com",
        to: [email],
        subject: "Your sign-in link",
        text: `Click to sign in (valid for 15 minutes):\n\n${link}\n\nIf you didn't ask for this, ignore it.`,
      }),
    });
    return res.ok;
  } catch (error) {
    console.warn("[auth] send failed:", (error as Error).message);
    return false;
  }
}
