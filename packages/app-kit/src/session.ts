import { SESSION_COOKIE, isValidSessionId, newSessionId } from "@probes/core";

/**
 * Read the visitor's session id from the Cookie header.
 *
 * Middleware mints it on the first request, so by the time a route handler
 * runs it is normally present; the fallback path exists for direct API calls
 * (curl, tests) and mints a fresh one rather than rejecting the request.
 */
export function readSessionId(request: Request): { sessionId: string; minted: boolean } {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey?.trim() !== SESSION_COOKIE) continue;
    const value = decodeURIComponent(rest.join("=").trim());
    if (isValidSessionId(value)) return { sessionId: value, minted: false };
  }
  return { sessionId: newSessionId(), minted: true };
}

export function sessionCookieHeader(sessionId: string): string {
  const parts = [
    `${SESSION_COOKIE}=${sessionId}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${60 * 60 * 24 * 90}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Attach a freshly minted session cookie to an outgoing response. */
export function withSessionCookie(response: Response, sessionId: string, minted: boolean): Response {
  if (minted) response.headers.append("set-cookie", sessionCookieHeader(sessionId));
  return response;
}
