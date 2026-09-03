import { randomUUID } from "node:crypto";
import { getStore, ingestFile, ingestText, isUserFacingError, recordCorpus } from "@probes/core/server";
import type { Json, IngestResult, ProbeId } from "@probes/core/server";
import { ensureSession, track } from "@probes/analytics";
import { readSessionId, withSessionCookie } from "./session.ts";

export type ProbeFlowOptions<T> = {
  probe: ProbeId;
  /** Corpus label for this run, e.g. "offer-letter". */
  kind: string;
  /** Turn extracted text/rows into the probe's result. Pure, synchronous logic. */
  analyse: (input: IngestResult, form: FormData) => T | Promise<T>;
  /** Extra props to attach to the result_viewed event. */
  eventProps?: (result: T) => Record<string, Json>;
};

/**
 * The shared upload -> extract -> reason -> store -> respond pipeline.
 *
 * Every document probe's POST route is a call to this with one `analyse`
 * function. That is the "one engine" the brief asked for: the probes differ
 * only in the pure function in the middle.
 */
export async function runProbeFlow<T>(
  request: Request,
  options: ProbeFlowOptions<T>,
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

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "Send the document as multipart form data." }, 400);
  }

  await ensureSession({
    id: sessionId,
    probe: options.probe,
    createdAt: new Date().toISOString(),
    userAgent: request.headers.get("user-agent"),
    referrer: request.headers.get("referer"),
  });
  await track({ probe: options.probe, sessionId, name: "upload_started", props: {} });

  // --- extract -------------------------------------------------------------
  let ingested: IngestResult;
  const file = form.get("file");
  const text = form.get("text");

  if (file instanceof File && file.size > 0) {
    ingested = await ingestFile(file.name, new Uint8Array(await file.arrayBuffer()));
  } else if (typeof text === "string" && text.trim().length > 0) {
    ingested = ingestText(text);
  } else {
    return json({ error: "Attach a file or paste the text." }, 400);
  }

  if (!ingested.ok) return json({ error: ingested.message }, 422);

  // --- reason --------------------------------------------------------------
  let result: T;
  try {
    result = await options.analyse(ingested, form);
  } catch (error) {
    if (isUserFacingError(error)) return json({ error: error.message }, error.status);
    console.error(`[${options.probe}] analyse failed:`, error);
    return json(
      {
        error:
          "We couldn't make sense of that document. If you think it's a valid one, email us a copy with anything private removed and we'll fix the parser.",
      },
      422,
    );
  }

  // --- store ---------------------------------------------------------------
  const artifactId = randomUUID();
  try {
    await getStore().saveArtifact({
      id: artifactId,
      probe: options.probe,
      sessionId,
      payload: result as unknown as Json,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // A result the visitor can see beats a result we can persist.
    console.warn(`[${options.probe}] artifact save failed:`, (error as Error).message);
  }

  await recordCorpus({
    probe: options.probe,
    kind: options.kind,
    input: { kind: ingested.kind, text: ingested.text.slice(0, 20000), meta: ingested.meta },
    output: result,
  });

  await track({
    probe: options.probe,
    sessionId,
    name: "result_viewed",
    props: { source: ingested.kind, ...(options.eventProps?.(result) ?? {}) },
  });

  return json({ id: artifactId, result });
}
