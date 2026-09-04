import { randomUUID } from "node:crypto";
import { getStore, isUserFacingError, recordCorpus } from "@probes/core/server";
import type { Json } from "@probes/core";
import { ensureSession, track } from "@probes/analytics";
import { readSessionId, withSessionCookie } from "@probes/app-kit";

export type DocumentKind = "invoice" | "advance-tax" | "contract";

/**
 * All three tools in this probe take JSON, run one pure function, persist the
 * result and hand back an id. Same shape as runProbeFlow, minus the file
 * ingestion — the inputs here are typed forms, not uploads.
 */
export async function handleDocument<TInput, TResult>(
  request: Request,
  options: {
    kind: DocumentKind;
    parse: (body: unknown) => TInput;
    build: (input: TInput) => TResult;
    eventProps?: (result: TResult) => Record<string, Json>;
  },
): Promise<Response> {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  await ensureSession({
    id: sessionId,
    probe: "freelancer-kit",
    createdAt: new Date().toISOString(),
    userAgent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  });
  await track({
    probe: "freelancer-kit",
    sessionId,
    name: "upload_started",
    props: { kind: options.kind },
  });

  let result: TResult;
  let input: TInput;
  try {
    input = options.parse(body);
    result = options.build(input);
  } catch (error) {
    if (isUserFacingError(error)) return json({ error: error.message }, error.status);
    console.error(`[freelancer-kit] ${options.kind} failed:`, error);
    return json({ error: "We couldn't build that document from those details." }, 422);
  }

  const id = randomUUID();
  try {
    await getStore().saveArtifact({
      id,
      probe: "freelancer-kit",
      sessionId,
      payload: { kind: options.kind, result } as unknown as Json,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn("[freelancer-kit] artifact save failed:", (error as Error).message);
  }

  await recordCorpus({
    probe: "freelancer-kit",
    kind: options.kind,
    input,
    output: result,
  });

  await track({
    probe: "freelancer-kit",
    sessionId,
    name: "result_viewed",
    props: { kind: options.kind, ...(options.eventProps?.(result) ?? {}) },
  });

  return json({ id, kind: options.kind, result });
}

/** Coerce an unknown JSON field to a trimmed, length-capped string. */
export const str = (value: unknown, max = 500): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** Coerce to a number, falling back rather than producing NaN or a silent 0. */
export const num = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

/** Rupees from the form to paise for the engines. */
export const toMinor = (value: unknown, fallback = 0): number =>
  Math.round(num(value, fallback / 100) * 100);
