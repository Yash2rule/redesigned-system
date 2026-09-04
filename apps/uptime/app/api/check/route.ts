import { randomUUID } from "node:crypto";
import { getStore, isUserFacingError, recordCorpus } from "@probes/core/server";
import type { Json } from "@probes/core";
import { ensureSession, track } from "@probes/analytics";
import { emailConfigured } from "@probes/email";
import {
  checkRateLimit,
  rateLimitKey,
  rateLimitedResponse,
  readSessionId,
  withSessionCookie,
} from "@probes/app-kit";
import { parseTargetGroups, parseTargets, runChecks } from "../../../lib/monitor.ts";
import { clientAssignments } from "../../../lib/clients.ts";
import { normaliseLogoUrl } from "../../../lib/brand.ts";
import type { Brand } from "../../../lib/brand.ts";

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

  // Stricter than the document probes: every run here makes outbound requests
  // to servers that belong to someone else. Ten runs an hour is generous for
  // a person and useless for a script.
  const limit = checkRateLimit(rateLimitKey(request, sessionId, "uptime-check"), {
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.ok) {
    return rateLimitedResponse(
      limit,
      `You have run ${limit.limit} checks in the last hour. Each one makes real requests to the sites you list, so we cap it — try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
    );
  }

  let body: {
    targets?: unknown;
    brandName?: unknown;
    brandColor?: unknown;
    logoUrl?: unknown;
    alertEmail?: unknown;
  };
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

  const rawTargets = typeof body.targets === "string" ? body.targets : "";
  let targets: string[];
  try {
    targets = parseTargets(rawTargets);
  } catch (error) {
    if (isUserFacingError(error)) return json({ error: error.message }, error.status);
    throw error;
  }

  const result = await runChecks(targets);
  // A "# Client name" line in the textarea assigns the domains under it, so an
  // agency can get a summary per client rather than one number for the lot.
  const clients = clientAssignments(parseTargetGroups(rawTargets));
  const logoUrl = normaliseLogoUrl(body.logoUrl);
  const brand: Brand = {
    name: typeof body.brandName === "string" ? body.brandName.slice(0, 60).trim() : "",
    color: typeof body.brandColor === "string" && /^#[0-9a-f]{6}$/i.test(body.brandColor)
      ? body.brandColor
      : "#7c3aed",
    ...(logoUrl ? { logoUrl } : {}),
  };

  // One address, validated. Change alerts go here when the daily re-check
  // finds something different.
  const alertEmail =
    typeof body.alertEmail === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.alertEmail.trim())
      ? body.alertEmail.trim().toLowerCase()
      : null;

  const id = randomUUID();
  try {
    await getStore().saveArtifact({
      id,
      probe: "uptime",
      sessionId,
      payload: {
        ...result,
        brand,
        clients,
        history: [],
        alertEmails: alertEmail ? [alertEmail] : [],
        // The first weekly summary lands a week from now — they have just
        // read these results on screen.
        lastWeeklyReportAt: new Date().toISOString(),
      } as unknown as Json,
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

  return json({
    id,
    result: { ...result, brand },
    alerts: alertEmail
      ? { address: alertEmail, live: emailConfigured() }
      : null,
  });
}
