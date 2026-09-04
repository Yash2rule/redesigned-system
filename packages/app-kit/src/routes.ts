import { capabilities, isEventName, answerSupportQuestion } from "@probes/core/server";
import type { Json, ProbeId } from "@probes/core/server";
import { ensureSession, track } from "@probes/analytics";
import { createCheckout, isValidEmail, paymentsLive } from "@probes/billing";
import type { Plan } from "@probes/billing";
import type { ProbeConfig } from "@probes/ui";
import { readSessionId, withSessionCookie } from "./session.ts";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

/** POST /api/track — the one endpoint every probe's client code posts to. */
export function createTrackRoute(probe: ProbeId) {
  return async function POST(request: Request): Promise<Response> {
    const { sessionId, minted } = readSessionId(request);
    let body: { name?: unknown; props?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    if (!isEventName(body.name)) return json({ error: "Unknown event name" }, 400);

    const props =
      body.props && typeof body.props === "object" && !Array.isArray(body.props)
        ? (body.props as Record<string, Json>)
        : {};

    await ensureSession({
      id: sessionId,
      probe,
      createdAt: new Date().toISOString(),
      userAgent: request.headers.get("user-agent"),
      referrer: typeof props.referrer === "string" ? props.referrer : request.headers.get("referer"),
    });
    await track({ probe, sessionId, name: body.name, props });

    return withSessionCookie(json({ ok: true }), sessionId, minted);
  };
}

/**
 * POST /api/checkout — real hosted checkout when keys exist, honest intent
 * capture when they don't. The client never decides which; the server does.
 */
export function createCheckoutRoute(probe: ProbeId, plans: Plan[]) {
  return async function POST(request: Request): Promise<Response> {
    const { sessionId, minted } = readSessionId(request);
    let body: { planId?: unknown; email?: unknown; note?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const plan = plans.find((p) => p.id === body.planId);
    if (!plan) return json({ mode: "error", message: "Unknown plan." }, 400);

    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email && !isValidEmail(email)) {
      return json({ mode: "error", message: "That email address doesn't look right." }, 400);
    }
    if (!email && !paymentsLive(plan.currency)) {
      return json({ mode: "error", message: "We need an email to tell you when payments open." }, 400);
    }

    await ensureSession({
      id: sessionId,
      probe,
      createdAt: new Date().toISOString(),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
    });

    const origin = new URL(request.url).origin;
    const result = await createCheckout({
      probe,
      plan,
      sessionId,
      email: email || undefined,
      returnUrl: `${origin}/thanks?plan=${encodeURIComponent(plan.id)}`,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : undefined,
    });

    if (result.mode === "intent" && result.recorded) {
      await track({
        probe,
        sessionId,
        name: "email_captured",
        props: { plan: plan.id, amount_minor: plan.amountMinor, currency: plan.currency },
      });
    }
    if (result.mode === "checkout") {
      await track({ probe, sessionId, name: "checkout_started", props: { plan: plan.id } });
    }

    return withSessionCookie(json(result), sessionId, minted);
  };
}

/** POST /api/support — FAQ-grounded answers, never invented ones. */
export function createSupportRoute(config: ProbeConfig) {
  return async function POST(request: Request): Promise<Response> {
    let body: { question?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    const question = typeof body.question === "string" ? body.question.slice(0, 500) : "";
    const answer = await answerSupportQuestion(question, {
      faq: config.faq,
      contactEmail: config.contactEmail,
      productName: config.name,
    });
    return json(answer);
  };
}

/**
 * GET /api/health — what this deployment can actually do.
 *
 * Exists because "is DATABASE_URL set on this preview?" is otherwise a
 * ten-minute guessing game, and because a probe silently losing its funnel
 * data is the worst possible failure here.
 */
export function createHealthRoute(probe: ProbeId) {
  return async function GET(): Promise<Response> {
    const caps = capabilities();
    return json({
      probe,
      ok: true,
      capabilities: caps,
      warnings: [
        caps.database
          ? null
          : "DATABASE_URL is not set — funnel data is stored on local disk and will not survive a redeploy.",
        caps.paymentsInr || caps.paymentsUsd
          ? null
          : "No payment keys — the buy button captures purchase intent and says so.",
        caps.llm ? null : "No LLM key — optional enrichment is off; core results are unaffected.",
      ].filter((w): w is string => w !== null),
      time: new Date().toISOString(),
    });
  };
}

export { json as jsonResponse };
