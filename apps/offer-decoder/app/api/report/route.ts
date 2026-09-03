import { getStore } from "@probes/core/server";
import { buildOfferReport } from "../../../lib/report.ts";
import type { DecodeResult } from "../../../lib/analyse.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/report?id=<artifact id> — the PDF for a result already produced. */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "offer-decoder") {
    return new Response("That report has expired or never existed.", { status: 404 });
  }

  const pdf = await buildOfferReport(artifact.payload as unknown as DecodeResult);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="offer-decoded-${id.slice(0, 8)}.pdf"`,
      "cache-control": "private, max-age=300",
    },
  });
}
