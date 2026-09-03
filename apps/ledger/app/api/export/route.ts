import { getStore } from "@probes/core/server";
import { buildLedgerWorkbook } from "../../../lib/export.ts";
import type { LedgerResult } from "../../../lib/ledger.ts";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/export?id=<artifact id> — the .xlsx for a ledger already built. */
export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const artifact = await getStore().getArtifact(id);
  if (!artifact || artifact.probe !== "ledger") {
    return new Response("That ledger has expired or never existed.", { status: 404 });
  }

  const workbook = await buildLedgerWorkbook(artifact.payload as unknown as LedgerResult);
  return new Response(new Uint8Array(workbook), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="ledger-${id.slice(0, 8)}.xlsx"`,
      "cache-control": "private, max-age=300",
    },
  });
}
