import { getStore } from "@probes/core/server";
import { isUserFacingError } from "@probes/core";
import { buildStatusReport } from "../../../lib/report.ts";
import type { BrandedResult } from "../../../lib/report.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/report?id=<artifact id>[&client=<name>] — the client-facing PDF.
 *
 * Without `client` it covers everything in the check. With one, it covers only
 * that client's domains — which is the version an agency can actually forward,
 * because the whole-portfolio report names every other client they have.
 */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const client = params.get("client")?.trim() || undefined;
  if (!id) return new Response("Missing id", { status: 400 });

  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "uptime") {
    return new Response("That report has expired or never existed.", { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await buildStatusReport(artifact.payload as unknown as BrandedResult, client);
  } catch (error) {
    if (isUserFacingError(error)) return new Response(error.message, { status: error.status });
    throw error;
  }

  // The client name goes in the filename too: an agency downloading six of
  // these in a row should not end up with six files called the same thing.
  const slug = client ? client.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) : null;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="site-health-${slug ? `${slug}-` : ""}${id.slice(0, 8)}.pdf"`,
      "cache-control": "private, max-age=300",
    },
  });
}
