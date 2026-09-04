import { SESSION_COOKIE, isValidSessionId } from "@probes/core/session.ts";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Mint the visitor's session id before any React runs, so the landing view and
 * the result view share one id. Without this the funnel counts requests
 * instead of people.
 *
 * Imports core's leaf module rather than the package barrel: this runs on the
 * edge runtime, where node:crypto and the Postgres driver are unavailable.
 */
export default function proxy(request: NextRequest) {
  const response = NextResponse.next();
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (!isValidSessionId(existing)) {
    response.cookies.set(SESSION_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  return response;
}

// Next requires this to be a statically analysable literal, so it cannot be
// imported from a shared package.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
