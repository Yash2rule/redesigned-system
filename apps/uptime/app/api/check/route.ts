import { randomUUID } from "node:crypto";
import { getStore, isUserFacingError, recordCorpus } from "@probes/core/server";
import type { Json } from "@probes/core";
import { ensureSession, track } from "@probes/analytics";
import { readSessionId, withSessionCookie } from "@probes/app-kit";
import { parseTargets, runChecks } from "../../../lib/monitor.ts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/check — the whole product, in one request.
 *
 * Not built on runProbeFlow: that pipeline is for document uploads, and this
 * probe's input is a list of domains rather than a file. It keeps the same
 * shape though — track, run, persist, record corpus, respond — so the admin
 * dashboard sees identical events across all four probes.
 */
export async function POST(request: Request): Promise<Response> {
  const { sessionId, minted } = readSessionId(request);
  const json = (body: unknown, status = 200) =>
    withSessionCookie(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      }),
      sessionId,
      minted,
    );

  let body: { targets?: unknown; brandName?: unknown; brandColor?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  await ensureSession({
    id: sessionId,
    probe: "uptime",
    createdAt: new Date().toISOString(),
    userAgent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  });
  await track({ probe: "uptime", sessionId, name: "upload_started", props: {} });

  let targets: string[];
  try {
    targets = parseTargets(typeof body.targets === "string" ? body.targets : "");
  } catch (error) {
    if (isUserFacingError(error)) return json({ error: error.message }, error.status);
    throw error;
  }

  const result = await runChecks(targets);
  const brand = {
    name: typeof body.brandName === "string" ? body.brandName.slice(0, 60).trim() : "",
    color: typeof body.brandColor === "string" && /^#[0-9a-f]{6}$/i.test(body.brandColor)
      ? body.brandColor
      : "#7c3aed",
  };

  const id = randomUUID();
  try {
    await getStore().saveArtifact({
      id,
      probe: "uptime",
      sessionId,
      payload: { ...result, brand, history: [] } as unknown as Json,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[uptime] artifact save failed:", (error as Error).message);
  }

  await recordCorpus({
    probe: "uptime",
    kind: "site-check",
    input: { targets },
    // Store the findings, not the brand: the corpus is for improving checks.
    output: { summary: result.summary, findings: result.monitors.map((m) => m.findings.map((f) => f.id)) },
  });

  await track({
    probe: "uptime",
    sessionId,
    name: "result_viewed",
    props: {
      monitors: result.summary.total,
      critical: result.summary.critical,
      warning: result.summary.warning,
    },
  });

  return json({ id, result: { ...result, brand } });
}
