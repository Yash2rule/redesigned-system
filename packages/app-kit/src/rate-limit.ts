/**
 * A small fixed-window rate limiter.
 *
 * In-process, so on a serverless host the limit is per warm instance rather
 * than global. That is a real limitation and it is stated in the response
 * header — but it still stops the thing that actually happens at this scale:
 * one person, one script, one loop. A distributed limiter would need a round
 * trip to Postgres on every request, which is the wrong trade for a product
 * measuring its first hundred visitors.
 *
 * It matters most for the uptime probe, which makes outbound requests to
 * third-party domains on behalf of anonymous visitors. Without a limit, that
 * is a request amplifier aimed at someone else's server.
 */

export type RateLimitRule = {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Drop expired buckets so a long-lived instance does not grow unboundedly. */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function checkRateLimit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + rule.windowMs };
  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(0, rule.limit - bucket.count);
  return {
    ok: bucket.count <= rule.limit,
    limit: rule.limit,
    remaining,
    resetAt: bucket.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * Identify the caller.
 *
 * Keyed on the forwarded IP, NOT on the session id. That distinction is the
 * whole limiter: a session id comes from a cookie the caller sends, so
 * including it means anyone can reset their own budget by dropping the cookie
 * — which a script does by default, since it never had one. A test asserts
 * this by hammering the endpoint with no cookie at all.
 *
 * The session is used only when there is no IP to key on, which in practice
 * means local development.
 *
 * The cost of keying on IP is that a shared office or carrier NAT shares a
 * budget. At the limits set here that is unlikely to bite, and the 429 message
 * invites an email rather than just refusing.
 */
export function rateLimitKey(
  request: Request,
  sessionId: string | null,
  scope: string,
): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip");
  if (ip) return `${scope}:ip:${ip}`;
  // No forwarded IP and no session: everyone shares one bucket. That is
  // deliberately the strict direction — routes with no session must not get a
  // laxer limit than routes with one just because they have less to key on.
  return `${scope}:session:${sessionId ?? "anonymous"}`;
}

/** The 429 response, with the headers a well-behaved client expects. */
export function rateLimitedResponse(result: RateLimitResult, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(result.retryAfterSeconds),
      "x-ratelimit-limit": String(result.limit),
      "x-ratelimit-remaining": String(result.remaining),
      "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
      // Say plainly that this is per-instance, so nobody builds on it thinking
      // it is a global guarantee.
      "x-ratelimit-scope": "per-instance",
    },
  });
}

/** Tests reset the shared map between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}
