import { getStore } from "@probes/core/server";
import {
  buildAdvanceTaxPdf,
  buildContractPdf,
  buildInvoicePdf,
} from "../../../lib/documents.ts";
import type { DocumentKind } from "../../../lib/handlers.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/document?id=<artifact id> — the PDF for whichever tool produced it. */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "freelancer-kit") {
    return new Response("That document has expired or never existed.", { status: 404 });
  }

  const payload = artifact.payload as unknown as { kind: DocumentKind; result: unknown };
  let pdf: Buffer;
  switch (payload.kind) {
    case "invoice":
      pdf = await buildInvoicePdf(payload.result as never);
      break;
    case "advance-tax":
      pdf = await buildAdvanceTaxPdf(payload.result as never);
      break;
    case "contract":
      pdf = await buildContractPdf(payload.result as never);
      break;
    default:
      return new Response("Unknown document type.", { status: 400 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${payload.kind}-${id.slice(0, 8)}.pdf"`,
      "cache-control": "private, max-age=300",
    },
  });
}
