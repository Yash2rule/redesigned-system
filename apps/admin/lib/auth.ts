import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@probes/core";

/**
 * Password gate for the dashboard.
 *
 * A single shared password from the environment, compared in constant time
 * against a SHA-256 digest so the comparison length does not leak. This is one
 * person's private dashboard behind an unguessable password, not a user
 * system — but "it's only me" is not a reason to write a timing-unsafe
 * comparison or to leave it open when the variable is unset.
 *
 * With ADMIN_PASSWORD unset the dashboard refuses to serve at all, rather than
 * defaulting to open. That matters: the funnel data includes the email
 * addresses of everyone who left one.
 */

export const ADMIN_COOKIE = "probe_admin";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function adminConfigured(): boolean {
  const password = env.adminPassword;
  return typeof password === "string" && password.length >= 8;
}

export function checkPassword(candidate: string): boolean {
  const password = env.adminPassword;
  if (!password || password.length < 8) return false;
  return timingSafeEqual(digest(candidate), digest(password));
}

/** The cookie value is a digest of the password, not the password itself. */
export function sessionToken(): string {
  const password = env.adminPassword;
  return password ? createHash("sha256").update(`probe-admin:${password}`).digest("hex") : "";
}

export function isAuthenticated(cookieHeader: string | null): boolean {
  if (!adminConfigured()) return false;
  const expected = sessionToken();
  const value = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  if (!value || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
