import { randomUUID } from "node:crypto";
import type { ProbeId } from "./types.ts";

export const SESSION_COOKIE = "probe_sid";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;

export function newSessionId(): string {
  return randomUUID();
}

/** A session id is only ever a UUID we minted; reject anything else. */
export function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export type VisitorContext = {
  sessionId: string;
  probe: ProbeId;
  userAgent: string | null;
  referrer: string | null;
};
