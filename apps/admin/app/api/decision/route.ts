import { getStore, isProbeId } from "@probes/core/server";
import { isAuthenticated } from "../../../lib/auth.ts";

export const runtime = "nodejs";

/** POST /api/decision — persist the kill/keep switch. Password-gated. */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthenticated(request.headers.get("cookie"))) {
    return new Response(JSON.stringify({ error: "Not signed in" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body: { probe?: unknown; decision?: unknown; note?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  if (!isProbeId(body.probe)) {
    return new Response(JSON.stringify({ error: "Unknown probe" }), { status: 400 });
  }
  const decision = body.decision;
  if (decision !== "keep" && decision !== "kill" && decision !== "undecided") {
    return new Response(JSON.stringify({ error: "Unknown decision" }), { status: 400 });
  }

  const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  await getStore().setProbeDecision(body.probe, decision, note);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
