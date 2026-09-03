import { getStore } from "@probes/core/server";
import { buildStatusReport } from "../../../lib/report.ts";
import type { BrandedResult } from "../../../lib/report.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/report?id=<artifact id> — the client-facing PDF. */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "uptime") {
    return new Response("That report has expired or never existed.", { status: 404 });
  }

  const pdf = await buildStatusReport(artifact.payload as unknown as BrandedResult);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="site-health-${id.slice(0, 8)}.pdf"`,
      "cache-control": "private, max-age=300",
    },
  });
}
